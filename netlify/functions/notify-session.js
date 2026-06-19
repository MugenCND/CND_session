// netlify/functions/notify-session.js
//
// Handles all engineer ↔ client email notifications.
// No npm dependencies — uses Supabase REST API directly.
//
// Required env vars:
//   RESEND_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY,
//   ENGINEER_EMAIL, NOTIFY_FROM_EMAIL,
//   CLIENT_PORTAL_BASE, ADMIN_PORTAL_URL

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { sessionId, kind, text, fromName, direction } = payload;
  if (!sessionId || !kind || !direction || !text)
    return { statusCode: 400, body: 'Missing required fields' };

  const SUPABASE_URL     = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY= process.env.SUPABASE_ANON_KEY;
  const RESEND_API_KEY   = process.env.RESEND_API_KEY;
  const ENGINEER_EMAIL   = process.env.ENGINEER_EMAIL   || 'studio@cndrecording.com';
  const FROM_EMAIL       = process.env.NOTIFY_FROM_EMAIL|| 'CND Sessions <notifications@cndrecording.com>';
  const CLIENT_PORTAL_BASE = process.env.CLIENT_PORTAL_BASE || 'https://cndsessions.netlify.app/?s=';
  const ADMIN_PORTAL_URL   = process.env.ADMIN_PORTAL_URL   || 'https://cndsessions-admin.netlify.app/';

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sessions?id=eq.${encodeURIComponent(sessionId)}&select=title,client_name,client_email,private_link_token`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (!res.ok) return { statusCode: 502, body: 'Session lookup failed' };
    const rows = await res.json();
    const session = rows && rows[0];
    if (!session) return { statusCode: 404, body: 'Session not found' };

    const kindLabel = {
      note:       'left a timestamped note on',
      message:    'sent a message about',
      submission: 'submitted feedback on',
      revision:   'requested a revision on',
      addressed:  'addressed a note on',
      status:     'updated the status of',
    }[kind] || 'updated';

    let to, subject, heading, link;

    if (direction === 'to_engineer') {
      to      = ENGINEER_EMAIL;
      link    = ADMIN_PORTAL_URL;
      subject = `${session.client_name || 'Client'} ${kindLabel} "${session.title}"`;
      heading = 'New client activity';
    } else if (direction === 'to_client') {
      if (!session.client_email)
        return { statusCode: 200, body: JSON.stringify({ skipped: 'no client email on file' }) };
      to      = session.client_email;
      link    = `${CLIENT_PORTAL_BASE}${session.private_link_token}`;
      subject = kind === 'addressed'
        ? `Your note on "${session.title}" has been addressed`
        : kind === 'status'
        ? `Update on your session "${session.title}"`
        : `New message on your session "${session.title}"`;
      heading = kind === 'addressed' ? 'Note addressed ✓'
              : kind === 'status'    ? 'Session updated'
              : 'Your engineer replied';
    } else {
      return { statusCode: 400, body: 'Invalid direction' };
    }

    const html = `
      <div style="font-family:Georgia,serif;background:#0B0C0E;padding:32px;">
        <div style="max-width:480px;margin:0 auto;">
          <p style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:3px;color:#e8830a;text-transform:uppercase;margin:0 0 18px;">Crackle &amp; Dust</p>
          <h2 style="font-size:20px;margin:0 0 12px;color:#e9e7e3;">${heading}</h2>
          <p style="font-size:14px;line-height:1.6;color:#bfbdb9;margin:0 0 18px;">
            ${fromName ? `<strong style="color:#e9e7e3;">${escapeHtml(fromName)}</strong>: ` : ''}${escapeHtml(text)}
          </p>
          <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#ffb15c,#e8830a);color:#1a0d00;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:13px;">Open session →</a>
        </div>
      </div>`;

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
    });

    if (!sendRes.ok) {
      console.error('Resend error:', await sendRes.text());
      return { statusCode: 502, body: 'Email send failed' };
    }

    return { statusCode: 200, body: JSON.stringify({ sent: true }) };
  } catch (err) {
    console.error('notify-session error:', err);
    return { statusCode: 500, body: 'Server error' };
  }
};

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
