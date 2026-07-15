/* FitnessCheck service worker — offline app shell + runtime caching.
   Bump CACHE_VERSION whenever index.html or the asset list changes; old caches
   are cleaned up on activate. */
const CACHE_VERSION = 'fc-v5';
const SHELL_CACHE = CACHE_VERSION + '-shell';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';

/* App shell — precached on install so the app opens with no network. */
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

/* Cross-origin hosts we DO cache at runtime (fonts + the html2canvas library).
   Anything cross-origin NOT in this list — notably the backend API — is never
   cached and always goes straight to the network. */
const RUNTIME_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com'
];

self.addEventListener('install', (event) => {
  // {cache:'reload'} bypasses the browser HTTP cache. GitHub Pages serves the app
  // with Cache-Control: max-age=600, so a plain fetch here can precache a STALE
  // index.html and then serve that old build offline until the next version bump.
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL_ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;            // never touch POSTs (backend writes)
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Navigations: network-first so an online load gets the latest app, with the
  // cached shell as the offline fallback.
  if (req.mode === 'navigate') {
    // {cache:'no-cache'} revalidates with the server (cheap 304 when unchanged) so an
    // online load always gets the current build rather than a stale HTTP-cached copy.
    event.respondWith(
      fetch(req.url, { cache: 'no-cache' })
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Same-origin static assets: cache-first.
  if (sameOrigin) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => hit))
    );
    return;
  }

  // Cross-origin fonts + html2canvas: cache-first runtime cache (primed on first
  // online load, then served offline).
  if (RUNTIME_HOSTS.indexOf(url.host) !== -1) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => hit))
    );
    return;
  }

  // Everything else (the backend API): straight to the network, never cached.
});
