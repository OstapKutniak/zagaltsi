// Service worker додатка «Цикл»: офлайн-кеш (network-first) + пуш-сповіщення.
const BASE = self.location.pathname.replace(/\/sw\.js$/, ''); // '/zagaltsi/cycle'
const V = 1; // бампати разом із APP_VERSION в app.js і ?v= у index.html
const CACHE = `cycle-v${V}`;
const ASSETS = [BASE + '/', BASE + '/index.html', BASE + '/manifest.json',
  `${BASE}/style.css?v=${V}`, `${BASE}/app.js?v=${V}`, `${BASE}/core.js?v=${V}`];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  // чистимо лише свої старі кеші — сусідні додатки на тому ж домені не чіпаємо
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE && k.startsWith('cycle-v')).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Цикл', {
    body: d.body || '',
    icon: BASE + '/icons/icon-192.png',
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
