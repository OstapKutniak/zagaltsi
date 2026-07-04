const CACHE = 'shop-v5';
const BASE = '/zagaltsi/shopping';
const ASSETS = [BASE+'/', BASE+'/index.html', BASE+'/style.css', BASE+'/app.js', BASE+'/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// ── PUSH-сповіщення ─────────────────────────────────────────
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Покупки', {
    body: d.body || '',
    icon: BASE + '/icons/icon-192.png',
    data: { url: d.url || BASE + '/' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.includes('/shopping/')) return c.focus();
    return clients.openWindow((e.notification.data && e.notification.data.url) || BASE + '/');
  }));
});
