/* Trade Journal service worker (hand-written, no build step).
 *
 * - Built static assets (/assets/*, hashed by Vite), icons and the manifest:
 *   cache-first — the hash in the filename changes whenever the content does.
 * - Page navigations: network-first; when the network fails, the offline page.
 * - /api/*, /screenshots/*, /ws/* and anything cross-origin or non-GET: never
 *   touched or cached. Journal data always comes live from the server.
 *
 * Bump VERSION to drop old caches after changing this file or the precache list.
 */
const VERSION = 'v1';
const STATIC_CACHE = `tj-static-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const PRECACHE = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-192.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('tj-') && k !== STATIC_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

const NEVER = ['/api/', '/screenshots/', '/ws/'];

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === OFFLINE_URL
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER.some((p) => url.pathname.startsWith(p))) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(OFFLINE_URL).then((r) => r || Response.error())
      )
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok && res.type === 'basic') cache.put(req, res.clone());
              return res;
            })
        )
      )
    );
  }
  // Everything else (e.g. /sw.js itself) goes straight to the network.
});
