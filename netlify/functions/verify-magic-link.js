// netlify/functions/verify-magic-link.js
//
// Client portal step 2: portal.html calls this when it loads with
// ?magic=TOKEN in the URL. Validates the short-lived token, issues a
// long-lived portal_token for persistent login, and returns client info.
//
// Required env vars: SUPABASE_URL, SUPABASE_ANON_KEY

const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const magicToken = payload.magicToken;
  if (!magicToken) return { statusCode: 400, body: 'Missing token' };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?magic_token=eq.${encodeURIComponent(magicToken)}&select=id,email,name,magic_token_expires_at`,
      { headers }
    );
    const rows = await res.json();
    const client = rows && rows[0];

    if (!client) return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or already-used link' }) };
    if (new Date(client.magic_token_expires_at) < new Date())
      return { statusCode: 401, body: JSON.stringify({ error: 'Link expired — request a new one' }) };

    const portalToken = crypto.randomBytes(32).toString('hex');

    await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${client.id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      // single-use: clear the magic token, store the new persistent one
      body: JSON.stringify({ magic_token: null, magic_token_expires_at: null, portal_token: portalToken })
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ portalToken, clientId: client.id, email: client.email, name: client.name })
    };
  } catch (err) {
    console.error('verify-magic-link error:', err);
    return { statusCode: 500, body: 'Server error' };
  }
};
