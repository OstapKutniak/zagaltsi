// Service worker спільний для всіх просторів (shopping, shopping-parents):
// простір визначає зі свого розташування, тому файл можна копіювати як є
// (копію для батьків робить vite.config.ts → shoppingSpacesPlugin).
const BASE = self.location.pathname.replace(/\/sw\.js$/, ''); // '/zagaltsi/shopping' або '/zagaltsi/shopping-parents'
const SPACE = BASE.split('/').pop();
const CACHE = `${SPACE}-v28`; // бампати разом із APP_VERSION в app.js
// style/app/icons завжди живуть в основному просторі — вони спільні
const SHARED = BASE.replace(/shopping-[^/]+$/, 'shopping');
const ASSETS = [BASE + '/', BASE + '/index.html', BASE + '/manifest.json',
  SHARED + '/style.css', SHARED + '/app.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  // чистимо лише кеші СВОГО простору (+ старі 'shop-v*'), щоб не вбити кеш сусіднього
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys
      .filter(k => k !== CACHE && (k.startsWith(`${SPACE}-v`) || k.startsWith('shop-v')))
      .map(k => caches.delete(k)))
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
    icon: SHARED + '/icons/icon-192.png',
    data: { url: d.url || BASE + '/' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.includes(BASE + '/')) return c.focus();
    return clients.openWindow((e.notification.data && e.notification.data.url) || BASE + '/');
  }));
});
