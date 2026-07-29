// ═══════════════════════════════════════════════════════
// GymOps — Service Worker (offline cache)
// Bump CACHE version when deploying new code
// ═══════════════════════════════════════════════════════
// 6.4 update strategy: app files are NETWORK-FIRST (fresh deploy reaches
// every online client on its next open — no double-reload, no manual hard
// refresh) with a timeout fallback to cache for offline / gym-basement
// reception. Successful responses refresh the cache in passing, so the
// offline copy tracks the newest code the client has ever seen. The vendored
// sql.js in /lib is the exception: cache-first, because it only ever changes
// with a repo-level upgrade (bump CACHE then) and re-downloading ~1.2MB of
// wasm on every open would be waste.

const CACHE = 'gymops-v100';

const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  // 6.7 about page. Precached (20KB) because it's reachable from Settings, and
  // without it an offline tap on "About GymOps" would hit the navigate fallback
  // below and silently land the user back on the app shell. Its screenshots
  // (245KB) stay out for the same reason the install ones do: never on the
  // critical path, but cached in passing by networkFirst once the page has been
  // opened online, so only a first visit that is also offline sees alt text.
  '/about.html',
  '/css/about.css',
  '/js/app.js',
  '/js/state.js',
  '/js/storage.js',
  '/js/ui.js',
  '/js/signals.js',
  '/js/idle.js',
  '/js/workout.js',
  '/js/picker.js',
  '/js/plans.js',
  '/js/history.js',
  '/js/settings.js',
  '/js/ai.js',
  '/js/db.js',
  '/js/aliases.js',
  '/js/import.js',
  '/js/import-ui.js',
  '/js/gdrive.js',
  '/lib/sql-wasm.js',
  '/lib/sql-wasm.wasm',
  // 6.5 install assets. The manifest and icons were never precached, so an
  // offline first visit had no icon and no installability. 32KB total.
  // Screenshots (244KB) are deliberately absent: only the browser's install UI
  // reads them, which is an online moment by definition, so they shouldn't be
  // on the critical path of a first install. They still END UP cached — the
  // network-first handler cache.puts any successful same-origin GET in passing
  // — which is the intent: not precached, but free once actually fetched.
  '/manifest.json',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  // NOT cached: /icons/og-card.png — only a social crawler ever fetches it, off
  // about.html, and never the app itself.
];

// Slow/flaky network: how long to wait before serving the cached copy.
const NETWORK_TIMEOUT_MS = 3500;

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

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Passthrough for API calls (POST /api/ai-summary) and cross-origin
  // requests (Google Drive/OAuth) — the SW only manages the app shell.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/lib/')) {
    e.respondWith(cacheFirst(e.request));
    return;
  }
  e.respondWith(networkFirst(e.request));
});

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), NETWORK_TIMEOUT_MS);
  try {
    const res = await fetch(req, { signal: ctl.signal });
    clearTimeout(timer);
    if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
    return res;
  } catch (err) {
    clearTimeout(timer);
    const hit = await caches.match(req);
    if (hit) return hit;
    if (req.mode === 'navigate') {
      // Deep link / query-string navigation while offline: any cached shell
      // beats a browser error page.
      const shell = await caches.match('/index.html');
      if (shell) return shell;
    }
    throw err;
  }
}
