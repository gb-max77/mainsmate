// Bump CACHE on every deploy or the SW serves stale assets.
const CACHE = 'mainsmate-v70';
const ASSETS = ['./', './index.html', './app.css', './js/app.js', './manifest.webmanifest', './data/questions.json'];

self.addEventListener('install', e => {
  // `reload` skips the HTTP cache, so a fresh worker never precaches the assets
  // the previous release left behind.
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // PDFs are tens of megabytes each — let the browser stream them from the
  // network rather than filling the cache quota with binaries.
  if (new URL(e.request.url).pathname.endsWith('.pdf')) return;
  // Pages sets max-age=600 on everything, so go to the network with `no-cache`:
  // it still revalidates cheaply against the ETag, but never serves a stale
  // asset from the browser's own store after a deploy.
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => { });
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
