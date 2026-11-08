/* ==== sw.js ==== オフライン用 Service Worker。版は version.js。シェルとデータを全部キャッシュしてから有効化 */
importScripts('./version.js');

const CACHE_NAME = `penview-${self.APP_VERSION}`;
const APP_SHELL = [
  './', './index.html', './version.js', './manifest.webmanifest', './css/app.css',
  './js/main.js', './js/state.js', './js/store.js', './js/geo.js', './js/coords.js', './js/projection.js',
  './js/map-view.js', './js/map-render.js', './js/gps.js', './js/ui.js',
  './data/land.json', './data/airspace.json', './data/airports.json', './data/navaids.json', './data/obstacles.json',
  './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('penview-') && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// キャッシュ優先（オフラインで必ず動く）。クエリ文字列は無視
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(() => (request.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
