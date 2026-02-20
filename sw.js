// ISBN Scanner — Service Worker v1
const CACHE = 'isbn-scanner-v1';

const APP_SHELL = [
  '/',
  '/assets/index.js',
  '/assets/index.css',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json',
];

// Install: pre-cache app shell
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)));
  self.skipWaiting();
});

// Activate: remove stale caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for app shell; network-first for external APIs
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Always use network for book lookups and Google Sheets
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('openlibrary.org') ||
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Cache-first for everything else (app shell)
  e.respondWith(
    caches.match(e.request).then(
      (cached) => cached || fetch(e.request).then((res) => {
        if (res.ok && e.request.method === 'GET' && url.origin === self.location.origin) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      })
    )
  );
});
