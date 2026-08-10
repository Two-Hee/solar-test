const CACHE_NAME = "solar-yield-v01-2";
const OFFLINE_ASSETS = [
  "./",
  "./index.html",
  "./assets/styles.css",
  "./assets/app.js",
  "./assets/solar-engine.js",
  "./assets/data-import.js",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./vendor/chart.umd.js",
  "./vendor/xlsx.full.min.js",
  "./vendor/exceljs.min.js",
  "./vendor/pptxgen.bundle.js",
  "./data/kma-monthly.js",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      return response;
    }).catch(() => caches.match("./index.html")))
  );
});
