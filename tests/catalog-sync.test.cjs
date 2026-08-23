const assert = require("node:assert/strict");
const { createHash, webcrypto } = require("node:crypto");
const test = require("node:test");
const {
  CATALOG_CACHE_NAME,
  CHECK_INTERVAL_MS,
  RAW_CATALOG_ROOT,
  createCatalogManager,
  validateManifest
} = require("../catalog-sync.js");

function fixture(rows, catalogPath = "stores.json", generatedAt = "2026-08-23T08:00:00.000Z") {
  const body = JSON.stringify(rows);
  return {
    body,
    manifest: {
      schemaVersion: 1,
      generatedAt,
      sha256: createHash("sha256").update(body).digest("hex"),
      storeCount: rows.length,
      catalogPath
    }
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function memoryCaches() {
  const namespaces = new Map();
  return {
    namespaces,
    async open(name) {
      if (!namespaces.has(name)) namespaces.set(name, new Map());
      const values = namespaces.get(name);
      return {
        async match(request) {
          const stored = values.get(String(request.url || request));
          return stored ? stored.clone() : undefined;
        },
        async put(request, response) {
          values.set(String(request.url || request), response.clone());
        }
      };
    }
  };
}

function jsonResponse(body) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function harness(localFixture, remoteFixture = localFixture, overrides = {}) {
  const requests = [];
  const storage = overrides.storage || memoryStorage();
  const cacheStorage = overrides.cacheStorage || memoryCaches();
  const manifestPath = localFixture.manifest.catalogPath === "stores.json"
    ? "stores-manifest.json"
    : "other-stores-manifest.json";
  let currentTime = Date.parse("2026-08-23T10:00:00.000Z");
  const fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url) === `./${manifestPath}`) return jsonResponse(localFixture.manifest);
    if (String(url) === `./${localFixture.manifest.catalogPath}`) return jsonResponse(localFixture.body);
    if (String(url) === `${RAW_CATALOG_ROOT}${manifestPath}`) return jsonResponse(remoteFixture.manifest);
    if (String(url) === `${RAW_CATALOG_ROOT}${remoteFixture.manifest.catalogPath}`) {
      return jsonResponse(overrides.remoteBody || remoteFixture.body);
    }
    return new Response("not found", { status: 404 });
  };
  const updates = [];
  const manager = createCatalogManager({
    fetch,
    cacheStorage,
    storage,
    crypto: webcrypto,
    locationHref: "https://example.test/zabhop/",
    minimumStoreCount: 1,
    now: () => currentTime,
    onUpdated: (mode, rows, manifest) => updates.push({ mode, rows, manifest })
  });
  return {
    manager,
    requests,
    updates,
    storage,
    cacheStorage,
    advance(ms) { currentTime += ms; }
  };
}

test("accepts only well-formed, path-bound store catalog manifests", () => {
  const { manifest } = fixture([["Z0001", 52.2, 21.0]]);
  assert.equal(validateManifest(manifest, "stores.json"), false);
  assert.equal(validateManifest(manifest, "stores.json", 1), true);
  assert.equal(validateManifest({ ...manifest, catalogPath: "other-stores.json" }, "stores.json", 1), false);
  assert.equal(validateManifest({ ...manifest, sha256: "not-a-digest" }, "stores.json", 1), false);
  assert.equal(validateManifest({ ...manifest, storeCount: 0 }, "stores.json", 1), false);
  assert.equal(validateManifest({ ...manifest, generatedAt: "never" }, "stores.json", 1), false);
});

test("loads only the selected local catalog and skips unchanged remote payloads", async () => {
  const local = fixture([["Z0001", 52.2, 21.0]]);
  const { manager, requests, advance } = harness(local);

  assert.deepEqual(await manager.load("zabka"), [["Z0001", 52.2, 21.0]]);
  assert.equal(requests.some(({ url }) => url.includes("other-stores")), false);

  assert.equal(await manager.refresh("zabka"), false);
  assert.equal(requests.filter(({ url }) => url === `${RAW_CATALOG_ROOT}stores-manifest.json`).length, 1);
  assert.equal(requests.some(({ url }) => url === `${RAW_CATALOG_ROOT}stores.json`), false);

  await manager.refresh("zabka");
  assert.equal(requests.filter(({ url }) => url === `${RAW_CATALOG_ROOT}stores-manifest.json`).length, 1);

  advance(CHECK_INTERVAL_MS + 1);
  await manager.refresh("zabka");
  assert.equal(requests.filter(({ url }) => url === `${RAW_CATALOG_ROOT}stores-manifest.json`).length, 2);
});

test("verifies and persists a changed catalog so it remains available offline", async () => {
  const local = fixture([["Z0001", 52.2, 21.0]]);
  const remote = fixture([["Z0001", 52.2, 21.0], ["Z0002", 52.3, 21.1]], "stores.json", "2026-08-24T08:00:00.000Z");
  const { manager, updates, cacheStorage, storage } = harness(local, remote);

  await manager.load("zabka");
  assert.equal(await manager.refresh("zabka"), true);
  assert.equal(manager.stateFor("zabka").rows.length, 2);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].manifest.sha256, remote.manifest.sha256);
  assert.ok(cacheStorage.namespaces.has(CATALOG_CACHE_NAME));

  const offlineManager = createCatalogManager({
    fetch: async () => { throw new Error("offline"); },
    cacheStorage,
    storage,
    crypto: webcrypto,
    locationHref: "https://example.test/zabhop/",
    minimumStoreCount: 1
  });
  assert.deepEqual(await offlineManager.load("zabka"), JSON.parse(remote.body));
});

test("rejects corrupted remote catalogs and preserves the last trusted version", async () => {
  const local = fixture([["Z0001", 52.2, 21.0]]);
  const remote = fixture([["Z0001", 52.2, 21.0], ["Z0002", 52.3, 21.1]]);
  const { manager, updates } = harness(local, remote, {
    remoteBody: JSON.stringify([["tampered", 1, 2], ["tampered-again", 3, 4]])
  });
  await manager.load("zabka");
  await assert.rejects(() => manager.refresh("zabka"), /integrity check/);
  assert.deepEqual(manager.stateFor("zabka").rows, JSON.parse(local.body));
  assert.equal(updates.length, 0);
});

test("updates the other-store catalog using its independent raw GitHub manifest", async () => {
  const local = fixture([{ id: "osm-1", lat: 52.2, lon: 21.0 }], "other-stores.json");
  const remote = fixture([
    { id: "osm-1", lat: 52.2, lon: 21.0 },
    { id: "osm-2", lat: 52.21, lon: 21.02 }
  ], "other-stores.json", "2026-08-30T08:00:00.000Z");
  const { manager, requests } = harness(local, remote);
  await manager.load("other");
  assert.equal(await manager.refresh("other"), true);
  assert.equal(manager.stateFor("other").rows.length, 2);
  assert.ok(requests.some(({ url }) => url === `${RAW_CATALOG_ROOT}other-stores-manifest.json`));
  assert.ok(requests.some(({ url }) => url === `${RAW_CATALOG_ROOT}other-stores.json`));
});
