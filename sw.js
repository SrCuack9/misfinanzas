const CACHE_NAME = 'misfinanzas-v29';
const ASSETS = [
    './',
    './index.html',
    './styles.css',
    './js/categories.js',
    './js/crypto.js',
    './js/db.js',
    './js/parser.js',
    './js/charts.js',
    './js/app.js',
    './lib/chart.umd.min.js',
    './lib/xlsx.full.min.js',
    './icon.svg',
    './manifest.json',
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    if (url.pathname.startsWith('/api/')) {
        e.respondWith(fetch(e.request));
        return;
    }
    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request))
    );
});
