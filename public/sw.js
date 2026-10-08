const CACHE_PREFIX = "tailvnc-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const SHELL_FILES = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/privacy.html",
  "/terms.html",
  "/legal.css",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/licenses/THIRD_PARTY_NOTICES.md",
];
const SHELL_PATHS = new Set(SHELL_FILES);
const NETWORK_ONLY = new Set(["/tailscale.wasm", "/wasm_exec.js"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (NETWORK_ONLY.has(url.pathname)) return;
  const isHashedAsset = url.pathname.startsWith("/assets/");
  if (!isHashedAsset && !SHELL_PATHS.has(url.pathname) && request.mode !== "navigate") return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, response.clone());
          }
          return response;
        } catch {
          return (await caches.match(request)) || caches.match("/index.html");
        }
      })(),
    );
    return;
  }

  if (isHashedAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, response.clone());
          }
          return response;
        });
      }),
    );
    return;
  }

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        return (await caches.match(request)) || Response.error();
      }
    })(),
  );
});