// netlify/functions/send-push.js
//
// Sends a web push notification to every subscribed admin device.
// Called internally by notify-session.js whenever a client triggers a
// to_engineer notification (note, message, submission, revision, bug).
//
// Required env vars:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: address),
//   SUPABASE_URL, SUPABASE_ANON_KEY

const webpush = require('web-push');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { title, body, url } = payload;
  if (!title || !body) return { statusCode: 400, body: 'Missing title or body' };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:studio@cndrecording.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?select=id,endpoint,subscription`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (!res.ok) return { statusCode: 502, body: 'Subscription lookup failed' };
    const subs = await res.json();

    const notifPayload = JSON.stringify({ title, body, url: url || '/' });

    const results = await Promise.allSettled(
      subs.map(async (row) => {
        try {
          await webpush.sendNotification(row.subscription, notifPayload);
        } catch (err) {
          // 410/404 = subscription is dead (uninstalled, expired) — clean it up
          if (err.statusCode === 410 || err.statusCode === 404) {
            await fetch(
              `${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${row.id}`,
              {
                method: 'DELETE',
                headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
              }
            );
          }
          throw err;
        }
      })
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    return { statusCode: 200, body: JSON.stringify({ sent, total: subs.length }) };
  } catch (err) {
    console.error('send-push error:', err);
    return { statusCode: 500, body: 'Server error' };
  }
};
