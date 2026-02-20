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
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
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
