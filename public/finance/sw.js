const CACHE = 'fin-v41';   // keep in sync with APP_VERSION in app.js
const BASE = '/zagaltsi/finance';
const ASSETS = [BASE+'/', BASE+'/index.html', BASE+'/style.css', BASE+'/app.js', BASE+'/manifest.json'];

self.addEventListener('install', e => {
  // cache:'reload' — bypass the browser HTTP cache (GitHub Pages sends max-age=600)
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

// Network-first. Own files are revalidated with the server every time
// (cache:'no-cache'), so a fresh deploy shows up on the next app open instead
// of after GitHub Pages' 10-minute HTTP cache expires. Offline → cached copy.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const own = url.origin === self.location.origin && url.pathname.startsWith(BASE);
  const net = own ? fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(e.request);
  e.respondWith(
    net.then(res => {
      if (own && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
