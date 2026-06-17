// netlify/functions/notify-session.js
//
// Sends a Resend email whenever a client leaves a timestamped note, sends a
// DM message, or submits overall feedback — and whenever the engineer
// replies to a client message.
//
// No npm dependencies required — talks to Supabase directly over its REST
// API instead of using @supabase/supabase-js, so there's nothing to install
// or bundle during the Netlify build.
//
// Required environment variables (set in Netlify site settings):
//   RESEND_API_KEY      — your existing Resend API key
//   SUPABASE_URL         — same project URL used in the app
//   SUPABASE_ANON_KEY    — same anon key used in the app (read-only lookup)
//   ENGINEER_EMAIL        — where client activity notifications go
//   NOTIFY_FROM_EMAIL     — verified Resend sender
//   CLIENT_PORTAL_BASE    — e.g. https://cndsessions.netlify.app/?s=
//   ADMIN_PORTAL_URL      — e.g. https://cndsessions-admin.netlify.app/

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { sessionId, kind, text, fromName, direction } = payload;
  if (!sessionId || !kind || !direction || !text) {
    return { statusCode: 400, body: 'Missing required fields' };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const ENGINEER_EMAIL = process.env.ENGINEER_EMAIL || 'studio@cndrecording.com';
  const FROM_EMAIL = process.env.NOTIFY_FROM_EMAIL || 'CND Sessions <notifications@cndrecording.com>';
  const CLIENT_PORTAL_BASE = process.env.CLIENT_PORTAL_BASE || 'https://cndsessions.netlify.app/?s=';
  const ADMIN_PORTAL_URL = process.env.ADMIN_PORTAL_URL || 'https://cndsessions-admin.netlify.app/';

  try {
    // Look up the session directly via Supabase's REST API (PostgREST)
    const lookupUrl = `${SUPABASE_URL}/rest/v1/sessions?id=eq.${encodeURIComponent(sessionId)}&select=title,client_name,client_email,private_link_token`;
    const lookupRes = await fetch(lookupUrl, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      }
    });

    if (!lookupRes.ok) {
      console.error('Supabase lookup failed:', await lookupRes.text());
      return { statusCode: 502, body: 'Session lookup failed' };
    }

    const rows = await lookupRes.json();
    const session = rows && rows[0];
    if (!session) {
      return { statusCode: 404, body: 'Session not found' };
    }

    const kindLabel = {
      note: 'left a timestamped note on',
      message: 'sent a message about',
      submission: 'submitted feedback on'
    }[kind] || 'updated';

    let to, subject, heading, link;

    if (direction === 'to_engineer') {
      to = ENGINEER_EMAIL;
      link = ADMIN_PORTAL_URL;
      subject = `${session.client_name || 'Client'} ${kindLabel} "${session.title}"`;
      heading = 'New client activity';
    } else if (direction === 'to_client') {
      if (!session.client_email) {
        return { statusCode: 200, body: JSON.stringify({ skipped: 'no client email on file' }) };
      }
      to = session.client_email;
      link = `${CLIENT_PORTAL_BASE}${session.private_link_token}`;
      subject = `New message on your session "${session.title}"`;
      heading = 'Your engineer replied';
    } else {
      return { statusCode: 400, body: 'Invalid direction' };
    }

    const html = `
      <div style="font-family:Georgia,serif;background:#15120F;padding:32px;">
        <div style="max-width:480px;margin:0 auto;">
          <p style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:3px;color:#D4920A;text-transform:uppercase;margin:0 0 18px;">Crackle &amp; Dust</p>
          <h2 style="font-size:20px;margin:0 0 12px;color:#EDE6D6;">${heading}</h2>
          <p style="font-size:14px;line-height:1.6;color:#cfc9bd;margin:0 0 18px;">
            ${fromName ? `<strong style="color:#EDE6D6;">${escapeHtml(fromName)}</strong>: ` : ''}${escapeHtml(text)}
          </p>
          <a href="${link}" style="display:inline-block;background:#D4920A;color:#15120F;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:13px;">Open session →</a>
        </div>
      </div>`;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
    });

    if (!resendRes.ok) {
      console.error('Resend error:', await resendRes.text());
      return { statusCode: 502, body: 'Email send failed' };
    }

    return { statusCode: 200, body: JSON.stringify({ sent: true }) };
  } catch (err) {
    console.error('notify-session error:', err);
    return { statusCode: 500, body: 'Server error' };
  }
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
