// Shared service worker for CND Sessions (covers both sessions-client.html
// and sessions-admin.html since they live on the same site).
// Light app-shell caching + push notification handling for admin alerts.

const CACHE_NAME = 'cnd-sessions-v1';
const SHELL_ASSETS = [
  '/',
  '/sessions-client.html',
  '/sessions-admin.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache Supabase, Cloudinary, Resend, or Netlify function calls —
  // those must always hit the network for live data.
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('cloudinary.com') ||
    url.pathname.startsWith('/.netlify/functions/')
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).catch(() => cached);
    })
  );
});

// ── PUSH NOTIFICATIONS (admin only — client never subscribes) ────
self.addEventListener('push', (event) => {
  let data = { title: 'CND Sessions', body: 'New activity on a session.', url: '/' };
  try { data = { ...data, ...event.data.json() }; } catch (e) {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/admin-icon-192.png',
      badge: '/icons/admin-icon-192.png',
      data: { url: data.url || '/' },
      vibrate: [80, 40, 80],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
