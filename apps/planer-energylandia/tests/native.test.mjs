import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PUBLIC_APP_URL,
  createNativeGeolocation,
  fetchShortLink,
  loadLiveSnapshot,
  nativeLocationError,
  publicShareHref,
} from "../src/native.js";

test("the paper-colored iOS interface keeps status-bar text dark and legible", () => {
  const config = JSON.parse(readFileSync(new URL("../capacitor.config.json", import.meta.url), "utf8"));
  // Capacitor LIGHT describes the background, not the text color.
  assert.equal(config.plugins.StatusBar.style, "LIGHT");
  assert.equal(config.backgroundColor, "#fff8f0");
});

test("A4 print pages allow WebKit rounding and native export rejects extra sheets", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const print = css.slice(css.indexOf("@media print"));
  assert.match(print, /\.pdf-page \{[^}]*min-height: 296mm;/);
  assert.match(print, /html, body, #root \{[^}]*min-height: 0 !important;/);
  const plugin = readFileSync(new URL("../ios/App/App/PogodaParkPDFPlugin.swift", import.meta.url), "utf8");
  assert.match(plugin, /count == expectedPages/);
});

test("native and local-file share links always use the public canonical app", () => {
  assert.equal(publicShareHref("capacitor://localhost/index.html#p/AbCdEfGhIjKlMn_o", true), PUBLIC_APP_URL);
  assert.equal(publicShareHref("file:///Bundle/index.html", false), PUBLIC_APP_URL);
  assert.equal(publicShareHref("https://another.example/preview/?draft=1", true), PUBLIC_APP_URL);
  assert.equal(publicShareHref("https://example.com/planer/?draft=1", false), "https://example.com/planer/?draft=1");
});

test("native live data uses the published HTTPS snapshot instead of the bundled release", async () => {
  const checkedAt = "2026-09-04T10:15:00.000Z";
  const requests = [];
  const result = await loadLiveSnapshot("park-calendar.json", {
    native: true,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ source: { checkedAt }, days: [] }) };
    },
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `${PUBLIC_APP_URL}park-calendar.json`);
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(result.source.checkedAt, checkedAt);
});

test("offline native fallback keeps the bundled date so stale data cannot become fresh", async () => {
  const original = { snapshot_generated_at: "2026-07-13T10:00:00.000Z", rides: [] };
  const requested = [];
  const result = await loadLiveSnapshot("live-queues.json", {
    native: true,
    baseUrl: "./",
    fetchImpl: async (url) => {
      requested.push(url);
      if (url.startsWith("https:")) throw new TypeError("offline");
      return { ok: true, json: async () => original };
    },
  });
  assert.deepEqual(requested, [`${PUBLIC_APP_URL}live-queues.json`, "./live-queues.json"]);
  assert.deepEqual(result, original);
});

test("native data cancellation does not start a fallback request after leaving the screen", async () => {
  const controller = new AbortController();
  let requests = 0;
  await assert.rejects(loadLiveSnapshot("live-shows.json", {
    native: true,
    signal: controller.signal,
    fetchImpl: async () => {
      requests += 1;
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    },
  }), { name: "AbortError" });
  assert.equal(requests, 1);
});

test("web data stays on its existing relative endpoint and does not hide errors", async () => {
  const requested = [];
  await assert.rejects(loadLiveSnapshot("live-shows.json", {
    native: false,
    baseUrl: "/planer/",
    fetchImpl: async (url) => { requested.push(url); return { ok: false, status: 503 }; },
  }), /503/);
  assert.deepEqual(requested, ["/planer/live-shows.json"]);
});

test("native snapshot loader rejects a non-snapshot URL before fetching", async () => {
  await assert.rejects(loadLiveSnapshot("../private.json", {
    native: true,
    fetchImpl: async () => assert.fail("must not fetch arbitrary paths"),
  }), /Nieznany plik/);
});

test("native shortlink transport sends only the anonymous payload to the exact service", async () => {
  let request;
  const response = await fetchShortLink("https://energylandia-shortlinks.mieszko-93c.workers.dev/plans", {
    method: "POST",
    body: JSON.stringify({ payload: "anonymous-compact-itinerary" }),
  }, {
    native: true,
    nativeRequest: async (options) => {
      request = options;
      return { status: 201, data: { token: "AbCdEfGhIjKlMn_o" } };
    },
  });
  assert.equal(response.ok, true);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).token, "AbCdEfGhIjKlMn_o");
  assert.equal(request.headers.Origin, "https://jakiesluchawki.github.io");
  assert.deepEqual(request.data, { payload: "anonymous-compact-itinerary" });
  assert.equal(request.disableRedirects, true);
  assert.ok(request.connectTimeout <= 15_000);
});

test("native shortlink transport never acts as an unrestricted HTTP bridge", async () => {
  for (const url of [
    "https://example.com/plans",
    "https://user:password@energylandia-shortlinks.mieszko-93c.workers.dev/plans",
    "http://energylandia-shortlinks.mieszko-93c.workers.dev/plans",
    "https://energylandia-shortlinks.mieszko-93c.workers.dev/other",
    "https://energylandia-shortlinks.mieszko-93c.workers.dev/plans?redirect=elsewhere",
  ]) {
    await assert.rejects(fetchShortLink(url, { method: "POST", body: "{}" }, {
      native: true,
      nativeRequest: async () => assert.fail("must not call native HTTP"),
    }), /Nieobsługiwany adres/);
  }
});

test("web shortlink transport preserves browser fetch and its origin behavior", async () => {
  const options = { method: "POST", body: "{}" };
  const expected = { ok: true };
  const response = await fetchShortLink("https://links.example/plans", options, {
    native: false,
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://links.example/plans");
      assert.equal(init, options);
      return expected;
    },
    nativeRequest: async () => assert.fail("browser must not use native HTTP"),
  });
  assert.equal(response, expected);
});

test("native GPS maps permission and timeout failures to existing clear UI states", () => {
  assert.equal(nativeLocationError({ code: "OS-PLUG-GLOC-0003" }).code, 1);
  assert.equal(nativeLocationError({ code: "OS-PLUG-GLOC-0008" }).code, 1);
  assert.equal(nativeLocationError({ code: "OS-PLUG-GLOC-0010" }).code, 3);
  assert.equal(nativeLocationError({ code: "OS-PLUG-GLOC-0007" }).code, 2);
});

test("Capacitor's thenable proxy is never assimilated by a GPS permission Promise", { timeout: 1000 }, async () => {
  let thenReads = 0;
  const position = { coords: { latitude: 50, longitude: 19, accuracy: 10 } };
  const methods = {
    checkPermissions: async () => ({ location: "granted" }),
    getCurrentPosition: async () => position,
    watchPosition: async (_options, callback) => { callback(position); return "native-watch"; },
    clearWatch: async () => {},
  };
  const proxy = new Proxy(methods, { get(target, key) {
    if (key === "then") { thenReads += 1; return () => {}; }
    return target[key];
  } });
  const geolocation = createNativeGeolocation(async () => ({ geolocation: proxy }));
  const current = await new Promise((resolve, reject) => geolocation.getCurrentPosition(resolve, reject));
  assert.equal(current, position);
  let watchId;
  const watched = await new Promise((resolve, reject) => { watchId = geolocation.watchPosition(resolve, reject); });
  assert.equal(watched, position);
  geolocation.clearWatch(watchId);
  assert.equal(thenReads, 0);
});

test("native GPS requests consent only when invoked and never reads position after denial", async () => {
  let prompts = 0;
  const geolocation = createNativeGeolocation(async () => ({
    checkPermissions: async () => ({ location: "prompt" }),
    requestPermissions: async () => { prompts += 1; return { location: "denied" }; },
    getCurrentPosition: async () => assert.fail("denied permission must not fetch location"),
  }));
  assert.equal(prompts, 0);
  const failure = await new Promise((resolve) => geolocation.getCurrentPosition(
    () => assert.fail("must not deliver a location"), resolve, {},
  ));
  assert.equal(prompts, 1);
  assert.equal(failure.code, 1);
});

test("native foreground resume never opens a new permission dialog", async () => {
  const geolocation = createNativeGeolocation(async () => ({
    checkPermissions: async () => ({ location: "prompt" }),
    requestPermissions: async () => assert.fail("resume must not request new consent"),
    getCurrentPosition: async () => assert.fail("position requires existing consent"),
  }));
  const failure = await new Promise((resolve) => geolocation.getCurrentPosition(
    () => assert.fail("no granted location"), resolve, { requestPermission: false },
  ));
  assert.equal(failure.code, 1);
});

test("resume reuses a pending user-initiated permission request without a second prompt", async () => {
  let resolvePermission;
  let notifyPrompt;
  const prompted = new Promise((resolve) => { notifyPrompt = resolve; });
  let prompts = 0;
  const geolocation = createNativeGeolocation(async () => ({
    checkPermissions: async () => ({ location: "prompt" }),
    requestPermissions: async () => {
      prompts += 1;
      notifyPrompt();
      return new Promise((resolve) => { resolvePermission = resolve; });
    },
    getCurrentPosition: async (options) => {
      assert.equal("requestPermission" in options, false);
      return { coords: { latitude: 50, longitude: 19, accuracy: 10 } };
    },
  }));
  const first = new Promise((resolve, reject) => geolocation.getCurrentPosition(resolve, reject, {}));
  await prompted;
  const resumed = new Promise((resolve, reject) => geolocation.getCurrentPosition(resolve, reject, { requestPermission: false }));
  await new Promise((resolve) => setImmediate(resolve));
  resolvePermission({ location: "granted" });
  const positions = await Promise.all([first, resumed]);
  assert.equal(prompts, 1);
  assert.equal(positions.length, 2);
});

test("native watch cancellation clears a watch whose asynchronous ID arrives later", async () => {
  let resolveNativeId;
  let notifyStarted;
  const started = new Promise((resolve) => { notifyStarted = resolve; });
  const cleared = [];
  const plugin = {
    checkPermissions: async () => ({ location: "granted" }),
    watchPosition: async () => {
      notifyStarted();
      return new Promise((resolve) => { resolveNativeId = resolve; });
    },
    clearWatch: async ({ id }) => { cleared.push(id); },
  };
  const geolocation = createNativeGeolocation(async () => plugin);
  const id = geolocation.watchPosition(() => assert.fail("cancelled watch must be silent"), assert.fail, {});
  await started;
  geolocation.clearWatch(id);
  resolveNativeId("native-watch-1");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(cleared, ["native-watch-1"]);
});
