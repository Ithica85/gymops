// ═══════════════════════════════════════════════════════
// GymOps — Service Worker (offline cache)
// Bump CACHE version when deploying new code
// ═══════════════════════════════════════════════════════

const CACHE = 'gymops-v29';

const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/db.js',
  '/js/gdrive.js',
  '/lib/sql-wasm.js',
  '/lib/sql-wasm.wasm',
];

// Cache all assets on install
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

// Remove old caches on activate
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first: serve from cache, fall back to network
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request))
  );
});
