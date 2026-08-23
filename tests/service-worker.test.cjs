const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const SCOPE = "https://example.test/zabhop/";

function workerHarness() {
  const listeners = new Map();
  const namespaces = new Map();
  const networkRequests = [];
  const precached = [];
  let offline = false;

  function keyFor(request) {
    return new URL(typeof request === "string" ? request : request.url, SCOPE).href;
  }

  const caches = {
    async open(name) {
      if (!namespaces.has(name)) namespaces.set(name, new Map());
      const entries = namespaces.get(name);
      return {
        async addAll(paths) {
          precached.push(...paths);
          for (const relativePath of paths) {
            const filePath = path.join(PROJECT_ROOT, relativePath.split("?")[0]);
            const body = fs.readFileSync(filePath);
            entries.set(keyFor(relativePath), new Response(body));
          }
        },
        async match(request, options = {}) {
          const key = keyFor(request);
          if (entries.has(key)) return entries.get(key).clone();
          if (options.ignoreSearch) {
            const requested = new URL(key);
            for (const [candidate, response] of entries) {
              if (new URL(candidate).pathname === requested.pathname) return response.clone();
            }
          }
          return undefined;
        },
        async put(request, response) { entries.set(keyFor(request), response.clone()); }
      };
    },
    async keys() { return [...namespaces.keys()]; },
    async delete(name) { return namespaces.delete(name); }
  };

  const self = {
    location: new URL(`${SCOPE}sw.js`),
    clients: { async claim() {} },
    async skipWaiting() {},
    addEventListener(type, handler) { listeners.set(type, handler); }
  };

  const network = async (request) => {
    const url = keyFor(request);
    networkRequests.push(url);
    if (offline) throw new Error("offline");
    const route = new URL(url).pathname.split("/").at(-1) || "index.html";
    return new Response(`network:${route}`, { status: 200 });
  };

  vm.runInNewContext(fs.readFileSync(path.join(PROJECT_ROOT, "sw.js"), "utf8"), {
    self,
    caches,
    fetch: network,
    URL,
    Set,
    Promise
  });

  async function lifecycle(type) {
    let pending;
    listeners.get(type)({ waitUntil(value) { pending = value; } });
    return pending;
  }

  async function dispatch(url, mode = "same-origin") {
    let response;
    const request = { url: new URL(url, SCOPE).href, mode, method: "GET" };
    listeners.get("fetch")({ request, respondWith(value) { response = value; } });
    return response ? { intercepted: true, response: await response } : { intercepted: false };
  }

  return {
    caches,
    namespaces,
    networkRequests,
    precached,
    lifecycle,
    dispatch,
    goOffline() { offline = true; }
  };
}

test("precaches a compact offline shell without catalogs or heavyweight artwork", async () => {
  const worker = workerHarness();
  await worker.lifecycle("install");
  assert.equal(worker.precached.some((asset) => /(?:^|\/)stores\.json|other-stores\.json/.test(asset)), false);
  assert.equal(worker.precached.some((asset) => /felt-(?:frog|background|compass|arrow)\.png/.test(asset)), false);
  assert.equal(worker.precached.some((asset) => /felt-compass-optimized|felt-arrow-optimized/.test(asset)), false);
  const bytes = worker.precached.reduce((total, asset) => {
    const filePath = path.join(PROJECT_ROOT, asset.split("?")[0]);
    return total + fs.statSync(filePath).size;
  }, 0);
  assert.ok(bytes < 850 * 1024, `offline shell should stay below 850 KB, got ${bytes}`);
});

test("keeps privacy/support navigation separate from the offline app shell", async () => {
  const worker = workerHarness();
  await worker.lifecycle("install");
  const privacy = await worker.dispatch("privacy.html", "navigate");
  assert.equal(await privacy.response.text(), "network:privacy.html");
  worker.goOffline();
  const index = await worker.dispatch("./", "navigate");
  const privacyOffline = await worker.dispatch("privacy.html", "navigate");
  assert.match(await index.response.text(), /id="startCard"/);
  assert.equal(await privacyOffline.response.text(), "network:privacy.html");
});

test("reuses cached static resources without hidden background refetches", async () => {
  const worker = workerHarness();
  await worker.lifecycle("install");
  const initialRequests = worker.networkRequests.length;
  const css = await worker.dispatch("styles.css?v=13");
  assert.equal(css.intercepted, true);
  assert.match(await css.response.text(), /\.walking-eta/);
  assert.equal(worker.networkRequests.length, initialRequests);
});

test("does not intercept Energylandia routes and preserves verified catalog caches", async () => {
  const worker = workerHarness();
  await worker.lifecycle("install");
  await worker.caches.open("zabhop-catalogs-v1");
  await worker.caches.open("zabhop-shell-v12");
  await worker.lifecycle("activate");
  assert.ok(worker.namespaces.has("zabhop-catalogs-v1"));
  assert.equal(worker.namespaces.has("zabhop-shell-v12"), false);
  assert.equal((await worker.dispatch("pogoda-energylandia/", "navigate")).intercepted, false);
  assert.equal((await worker.dispatch("pogoda-energylandia/assets/app.js")).intercepted, false);
  assert.equal((await worker.dispatch("https://raw.githubusercontent.com/jakiesluchawki/zabhop/main/stores.json")).intercepted, false);
});
