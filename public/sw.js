const CACHE_NAME = "fruitfit-v2";
const CORE_ASSETS = ["/data/nutrition.json", "/data/courses.json", "/data/lessons.json", "/data/exercises.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (request.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith(".html") || url.pathname.startsWith("/assets/")) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  const isFoodImage = /static\.tildacdn\.com/.test(url.hostname);
  const isLocalAsset = url.origin === self.location.origin;

  if (!isFoodImage && !isLocalAsset) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      }).catch(() => cached);
      return cached || fetchPromise;
    }),
  );
});
