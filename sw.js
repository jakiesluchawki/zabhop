const CACHE_NAME = "zabhop-shell-v13";
const APP_SCOPE = new URL("./", self.location.href);
const SHELL = [
  "./index.html",
  "./styles.css?v=13",
  "./theme.js?v=13",
  "./heading-filter.js?v=13",
  "./store-hours.js?v=13",
  "./catalog-sync.js?v=13",
  "./app.js?v=13",
  "./manifest.webmanifest?v=5",
  "./icon-192.png",
  "./felt-frog-optimized.jpg",
  "./felt-background-optimized.jpg",
  "./privacy.html",
  "./support.html",
  "./fonts/Romie-Regular.woff2",
  "./fonts/Roobert-Regular.woff2",
  "./fonts/Roobert-Bold.woff2"
];

const ROOT_FILES = new Set([
  "index.html", "styles.css", "theme.js", "heading-filter.js", "store-hours.js",
  "catalog-sync.js", "app.js", "manifest.webmanifest", "privacy.html", "support.html",
  "icon-192.png", "icon-512.png", "felt-frog-optimized.jpg", "felt-background-optimized.jpg",
  "felt-compass-optimized.jpg", "felt-arrow-optimized.png", "stores.json",
  "stores-manifest.json", "other-stores.json", "other-stores-manifest.json"
]);

function routeFor(url) {
  if (url.origin !== APP_SCOPE.origin || !url.pathname.startsWith(APP_SCOPE.pathname)) return null;
  const relativePath = url.pathname.slice(APP_SCOPE.pathname.length);
  if (!relativePath || relativePath === "index.html") return "index.html";
  if (relativePath === "privacy.html" || relativePath === "support.html") return relativePath;
  return null;
}

function ownsResource(url) {
  if (url.origin !== APP_SCOPE.origin || !url.pathname.startsWith(APP_SCOPE.pathname)) return false;
  const relativePath = url.pathname.slice(APP_SCOPE.pathname.length);
  if (relativePath.startsWith("fonts/")) return !relativePath.slice("fonts/".length).includes("/");
  return !relativePath.includes("/") && ROOT_FILES.has(relativePath);
}

async function navigationResponse(request, route) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(new URL(`./${route}`, APP_SCOPE).href, response.clone());
    }
    return response;
  } catch (error) {
    const offline = await cache.match(new URL(`./${route}`, APP_SCOPE).href, { ignoreSearch: true });
    if (offline) return offline;
    throw error;
  }
}

async function cachedResource(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith("zabhop-shell-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  if (event.request.mode === "navigate") {
    const route = routeFor(url);
    if (route) event.respondWith(navigationResponse(event.request, route));
    return;
  }

  if (ownsResource(url)) event.respondWith(cachedResource(event.request));
});
