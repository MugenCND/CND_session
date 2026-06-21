// netlify/functions/request-magic-link.js
//
// Client portal step 1: client types their email, this looks up (or
// creates) their client record, issues a short-lived magic token, and
// emails them a sign-in link.
//
// Required env vars: RESEND_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY,
//                     NOTIFY_FROM_EMAIL, PORTAL_BASE

const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const email = (payload.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return { statusCode: 400, body: 'Valid email required' };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const FROM_EMAIL = process.env.NOTIFY_FROM_EMAIL || 'CND Sessions <notifications@cndrecording.com>';
  const PORTAL_BASE = process.env.PORTAL_BASE || 'https://cndsessions.netlify.app/portal.html';

  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    const lookupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?email=eq.${encodeURIComponent(email)}&select=id`,
      { headers }
    );
    const rows = await lookupRes.json();
    let clientId = rows && rows[0] && rows[0].id;

    const magicToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    if (clientId) {
      await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ magic_token: magicToken, magic_token_expires_at: expiresAt })
      });
    } else {
      const createRes = await fetch(`${SUPABASE_URL}/rest/v1/clients`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ email, magic_token: magicToken, magic_token_expires_at: expiresAt })
      });
      const created = await createRes.json();
      clientId = created && created[0] && created[0].id;
    }

    if (!clientId) return { statusCode: 500, body: 'Could not create client record' };

    const link = `${PORTAL_BASE}?magic=${magicToken}`;
    const html = `
      <div style="font-family:Georgia,serif;background:#0B0C0E;padding:32px;">
        <div style="max-width:480px;margin:0 auto;">
          <p style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:3px;color:#e8830a;text-transform:uppercase;margin:0 0 18px;">Crackle &amp; Dust</p>
          <h2 style="font-size:20px;margin:0 0 12px;color:#e9e7e3;">Sign in to your sessions</h2>
          <p style="font-size:14px;line-height:1.6;color:#bfbdb9;margin:0 0 18px;">Tap below to access all your sessions. This link expires in 15 minutes and works once.</p>
          <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#ffb15c,#e8830a);color:#1a0d00;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:13px;">Sign in →</a>
        </div>
      </div>`;

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: email, subject: 'Your CND Sessions sign-in link', html })
    });

    if (!sendRes.ok) {
      console.error('Resend error:', await sendRes.text());
      return { statusCode: 502, body: 'Email send failed' };
    }

    return { statusCode: 200, body: JSON.stringify({ sent: true }) };
  } catch (err) {
    console.error('request-magic-link error:', err);
    return { statusCode: 500, body: 'Server error' };
  }
};
