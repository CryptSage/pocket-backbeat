// Cache only the versioned-in-repo app shell. Data is intentionally kept in localStorage.
const CACHE_NAME = 'pocket-backbeat-shell-v7';
const APP_SHELL = ['./', './index.html', './style.css', './app.js', './manifest.json', './logo.png', './favicon.png'];

// Install the shell in one transaction so an offline launch never gets a partial app.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

// Remove old named shells after an update has taken control.
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

// The shell is cache-first; external Sheet requests are never cached by the service worker.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
