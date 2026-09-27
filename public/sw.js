// Routing mirrors src/lib/pwa/sw-route.ts (tested there). Keep them in step.
//
// Install only: the one thing cached is /offline.html. Nothing authenticated
// is ever cached, and only same-origin GET navigations are intercepted.
const CACHE = "clips-offline-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add("/offline.html")));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const sameOrigin = new URL(req.url).origin === self.location.origin;
  if (req.mode !== "navigate" || req.method !== "GET" || !sameOrigin) return; // passthrough

  // Whatever the network answers — a page, an error page, Authentik's redirect — goes
  // through untouched. Only a failure to reach the network at all shows the offline page.
  event.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
});
