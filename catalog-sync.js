(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ZabHopCatalogSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const RAW_CATALOG_ROOT = "https://raw.githubusercontent.com/jakiesluchawki/zabhop/main/";
  const CATALOG_CACHE_NAME = "zabhop-catalogs-v1";
  const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const FAILURE_RETRY_INTERVAL_MS = 10 * 60 * 1000;
  const MINIMUM_STORE_COUNT = 10000;
  const MODES = {
    zabka: { catalogPath: "stores.json", manifestPath: "stores-manifest.json" },
    other: { catalogPath: "other-stores.json", manifestPath: "other-stores-manifest.json" }
  };

  function validateManifest(manifest, expectedCatalogPath, minimumStoreCount = MINIMUM_STORE_COUNT) {
    if (!manifest || typeof manifest !== "object") return false;
    if (manifest.schemaVersion !== 1 || manifest.catalogPath !== expectedCatalogPath) return false;
    if (!/^[a-f0-9]{64}$/.test(manifest.sha256 || "")) return false;
    if (!Number.isSafeInteger(manifest.storeCount) || manifest.storeCount < minimumStoreCount) return false;
    return typeof manifest.generatedAt === "string" && Number.isFinite(Date.parse(manifest.generatedAt));
  }

  async function sha256Hex(buffer, cryptoProvider = globalThis.crypto) {
    if (!cryptoProvider?.subtle) throw new Error("Secure catalog verification is unavailable");
    const digest = await cryptoProvider.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function createCatalogManager(options = {}) {
    const fetchResource = options.fetch || globalThis.fetch?.bind(globalThis);
    const cacheStorage = options.cacheStorage ?? globalThis.caches;
    const storage = options.storage ?? globalThis.localStorage;
    const cryptoProvider = options.crypto ?? globalThis.crypto;
    const locationHref = options.locationHref || globalThis.location?.href || "https://jakiesluchawki.github.io/zabhop/";
    const rawCatalogRoot = options.rawCatalogRoot || RAW_CATALOG_ROOT;
    const minimumStoreCount = Number.isSafeInteger(options.minimumStoreCount)
      ? Math.max(1, options.minimumStoreCount)
      : MINIMUM_STORE_COUNT;
    const now = typeof options.now === "function" ? options.now : Date.now;
    const onUpdated = typeof options.onUpdated === "function" ? options.onUpdated : () => {};
    const memory = new Map();
    const loading = new Map();
    const refreshing = new Map();
    const attemptedAt = new Map();

    function configFor(mode) {
      const config = MODES[mode];
      if (!config) throw new Error(`Unknown catalog mode: ${mode}`);
      return config;
    }

    function cacheRequest(mode) {
      const { catalogPath } = configFor(mode);
      return new URL(`./__zabhop_catalogs__/${catalogPath}`, locationHref).href;
    }

    function storageKey(mode) {
      return `zabhop-catalog-checked-v1-${mode}`;
    }

    function lastCheckedAt(mode) {
      try {
        const checkedAt = Number(storage?.getItem(storageKey(mode)));
        return Number.isFinite(checkedAt) ? checkedAt : 0;
      } catch (_) {
        return 0;
      }
    }

    function rememberCheck(mode) {
      try { storage?.setItem(storageKey(mode), String(now())); } catch (_) { /* Optional preference. */ }
    }

    async function request(url, timeoutMs, fresh = false) {
      if (typeof fetchResource !== "function") throw new Error("Catalog networking is unavailable");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchResource(url, {
          signal: controller.signal,
          cache: fresh ? "no-store" : "default",
          headers: { Accept: "application/json" }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response;
      } finally {
        clearTimeout(timer);
      }
    }

    function decodeCatalog(buffer, manifest) {
      const rows = JSON.parse(new TextDecoder().decode(buffer));
      if (!Array.isArray(rows) || rows.length === 0) throw new Error("The store catalog is empty");
      if (manifest && rows.length !== manifest.storeCount) {
        throw new Error("The store catalog does not match its manifest");
      }
      return rows;
    }

    async function readPersisted(mode) {
      if (!cacheStorage?.open) return null;
      try {
        const cache = await cacheStorage.open(CATALOG_CACHE_NAME);
        const response = await cache.match(cacheRequest(mode));
        if (!response) return null;
        const { catalogPath } = configFor(mode);
        const manifest = {
          schemaVersion: 1,
          catalogPath,
          generatedAt: response.headers.get("x-zabhop-generated-at"),
          sha256: response.headers.get("x-zabhop-sha256"),
          storeCount: Number(response.headers.get("x-zabhop-store-count"))
        };
        if (!validateManifest(manifest, catalogPath, minimumStoreCount)) return null;
        const buffer = await response.arrayBuffer();
        return { rows: decodeCatalog(buffer, manifest), manifest };
      } catch (_) {
        return null;
      }
    }

    async function persist(mode, buffer, manifest) {
      if (!cacheStorage?.open || !manifest) return;
      try {
        const cache = await cacheStorage.open(CATALOG_CACHE_NAME);
        await cache.put(cacheRequest(mode), new Response(buffer, {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "x-zabhop-generated-at": manifest.generatedAt,
            "x-zabhop-sha256": manifest.sha256,
            "x-zabhop-store-count": String(manifest.storeCount)
          }
        }));
      } catch (_) { /* Safari private browsing can disable persistent caches. */ }
    }

    async function readLocalManifest(mode) {
      const { catalogPath, manifestPath } = configFor(mode);
      try {
        const response = await request(`./${manifestPath}`, 4500);
        const manifest = await response.json();
        return validateManifest(manifest, catalogPath, minimumStoreCount) ? manifest : null;
      } catch (_) {
        return null;
      }
    }

    async function load(mode) {
      configFor(mode);
      const existing = memory.get(mode);
      if (existing) return existing.rows;
      if (loading.has(mode)) return loading.get(mode);

      const task = (async () => {
        const persisted = await readPersisted(mode);
        if (persisted) {
          memory.set(mode, persisted);
          return persisted.rows;
        }

        const { catalogPath } = configFor(mode);
        const manifestPromise = readLocalManifest(mode);
        const response = await request(`./${catalogPath}`, 15000);
        const buffer = await response.arrayBuffer();
        const manifest = await manifestPromise;
        const rows = decodeCatalog(buffer, manifest);
        memory.set(mode, { rows, manifest });
        await persist(mode, buffer, manifest);
        return rows;
      })();

      loading.set(mode, task);
      try { return await task; } finally { loading.delete(mode); }
    }

    async function refresh(mode, options = {}) {
      const { catalogPath, manifestPath } = configFor(mode);
      if (refreshing.has(mode)) return refreshing.get(mode);

      const currentTime = now();
      const lastAttempt = attemptedAt.get(mode) || 0;
      if (!options.force && currentTime - lastCheckedAt(mode) < CHECK_INTERVAL_MS) return false;
      if (!options.force && lastAttempt > 0 && currentTime - lastAttempt < FAILURE_RETRY_INTERVAL_MS) return false;
      attemptedAt.set(mode, currentTime);

      const task = (async () => {
        const manifestResponse = await request(`${rawCatalogRoot}${manifestPath}`, 6500, true);
        const manifest = await manifestResponse.json();
        if (!validateManifest(manifest, catalogPath, minimumStoreCount)) {
          throw new Error("The remote store manifest is invalid");
        }

        let current = memory.get(mode);
        if (!current) {
          await load(mode);
          current = memory.get(mode);
        }

        if (current?.manifest?.sha256 === manifest.sha256) {
          rememberCheck(mode);
          return false;
        }

        const catalogResponse = await request(`${rawCatalogRoot}${catalogPath}`, 20000, true);
        const buffer = await catalogResponse.arrayBuffer();
        if (await sha256Hex(buffer, cryptoProvider) !== manifest.sha256) {
          throw new Error("The store catalog failed its SHA-256 integrity check");
        }

        const rows = decodeCatalog(buffer, manifest);
        await persist(mode, buffer, manifest);
        memory.set(mode, { rows, manifest });
        rememberCheck(mode);
        await onUpdated(mode, rows, manifest);
        return true;
      })();

      refreshing.set(mode, task);
      try { return await task; } finally { refreshing.delete(mode); }
    }

    function stateFor(mode) {
      const current = memory.get(mode);
      return current ? { rows: current.rows, manifest: current.manifest } : null;
    }

    return { load, refresh, stateFor };
  }

  return {
    CATALOG_CACHE_NAME,
    CHECK_INTERVAL_MS,
    MINIMUM_STORE_COUNT,
    RAW_CATALOG_ROOT,
    createCatalogManager,
    sha256Hex,
    validateManifest
  };
});
