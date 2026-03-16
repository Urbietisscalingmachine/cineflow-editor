/**
 * Cineflow Service Worker
 *
 * Handles offline functionality by caching application assets.
 * Implements a cache-first strategy for static assets and network-first for API calls.
 */

const CACHE_NAME = "cineflow-v1";
const STATIC_CACHE_NAME = "cineflow-static-v1";
const DYNAMIC_CACHE_NAME = "cineflow-dynamic-v1";

/**
 * Static assets to cache on install
 */
const STATIC_ASSETS = ["/", "/index.html", "/manifest.json"];

/**
 * Patterns for assets that should be cached dynamically
 */
const CACHEABLE_PATTERNS = [
  /\.js$/,
  /\.css$/,
  /\.woff2?$/,
  /\.ttf$/,
  /\.eot$/,
  /\.svg$/,
  /\.png$/,
  /\.jpg$/,
  /\.jpeg$/,
  /\.gif$/,
  /\.webp$/,
  /\.ico$/,
];

/**
 * Patterns for requests that should never be cached (AI features, etc.)
 */
const NO_CACHE_PATTERNS = [
  /api\.anthropic\.com/,
  /api\.openai\.com/,
  /whisper/,
  /transcribe/,
  /\/api\//,
];

function shouldCache(url) {
  const urlString = url.toString();
  if (NO_CACHE_PATTERNS.some((pattern) => pattern.test(urlString))) {
    return false;
  }
  return CACHEABLE_PATTERNS.some((pattern) => pattern.test(urlString));
}

function isAIRequest(url) {
  const urlString = url.toString();
  return NO_CACHE_PATTERNS.some((pattern) => pattern.test(urlString));
}

self.addEventListener("install", (event) => {
  console.log("[ServiceWorker] Installing...");
  event.waitUntil(
    caches
      .open(STATIC_CACHE_NAME)
      .then((cache) => {
        console.log("[ServiceWorker] Caching static assets");
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log("[ServiceWorker] Static assets cached");
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error("[ServiceWorker] Failed to cache static assets:", error);
      })
  );
});

self.addEventListener("activate", (event) => {
  console.log("[ServiceWorker] Activating...");
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => {
              return (
                (name.startsWith("cineflow-") || name.startsWith("openreel-")) &&
                name !== STATIC_CACHE_NAME &&
                name !== DYNAMIC_CACHE_NAME
              );
            })
            .map((name) => {
              console.log("[ServiceWorker] Deleting old cache:", name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log("[ServiceWorker] Activated");
        return self.clients.claim();
      })
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  if (!url.protocol.startsWith("http")) return;

  if (isAIRequest(url)) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({
            error: "AI_OFFLINE",
            message: "AI features require an internet connection.",
          }),
          {
            status: 503,
            statusText: "Service Unavailable",
            headers: { "Content-Type": "application/json" },
          }
        );
      })
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(DYNAMIC_CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            return caches.match("/index.html");
          });
        })
    );
    return;
  }

  if (shouldCache(url)) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          event.waitUntil(
            fetch(request)
              .then((networkResponse) => {
                if (networkResponse.ok) {
                  caches.open(DYNAMIC_CACHE_NAME).then((cache) => {
                    cache.put(request, networkResponse);
                  });
                }
              })
              .catch(() => {})
          );
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          if (networkResponse.ok) {
            const responseClone = networkResponse.clone();
            caches.open(DYNAMIC_CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => response)
      .catch(() => caches.match(request))
  );
});

self.addEventListener("message", (event) => {
  const { type } = event.data || {};
  switch (type) {
    case "SKIP_WAITING":
      self.skipWaiting();
      break;
    case "GET_CACHE_STATUS":
      getCacheStatus().then((status) => {
        event.ports[0].postMessage({ type: "CACHE_STATUS", payload: status });
      });
      break;
    case "CLEAR_CACHE":
      clearAllCaches().then(() => {
        event.ports[0].postMessage({ type: "CACHE_CLEARED" });
      });
      break;
    case "CHECK_ONLINE":
      event.ports[0].postMessage({
        type: "ONLINE_STATUS",
        payload: { online: navigator.onLine },
      });
      break;
  }
});

async function getCacheStatus() {
  const cacheNames = await caches.keys();
  let totalEntries = 0;
  for (const name of cacheNames) {
    if (name.startsWith("cineflow-")) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      totalEntries += keys.length;
    }
  }
  return {
    cacheNames: cacheNames.filter((n) => n.startsWith("cineflow-")),
    totalEntries,
    version: CACHE_NAME,
  };
}

async function clearAllCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames
      .filter((name) => name.startsWith("cineflow-") || name.startsWith("openreel-"))
      .map((name) => caches.delete(name))
  );
}

console.log("[ServiceWorker] Cineflow script loaded");
