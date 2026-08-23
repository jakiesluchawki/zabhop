import test from "node:test";
import assert from "node:assert/strict";
import {
  checkForAppUpdate,
  normalizedRelease,
  startAppUpdateChecks,
  withReleaseQuery,
} from "../src/appUpdate.js";

function fakeStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
}

test("identyfikator wydania przyjmuje wyłącznie prawdziwy hash Git", () => {
  assert.equal(normalizedRelease("ABCDEF1234567890"), "abcdef123456");
  assert.equal(normalizedRelease("dev"), null);
  assert.equal(normalizedRelease("version-2026"), null);
});

test("wersjonowany adres zachowuje parametry i krótki plan", () => {
  assert.equal(
    withReleaseQuery("https://example.com/planer/?preview=1&r0123456789ab#p/AbCdEfGhIjKlMn_o", "abcdef123456"),
    "https://example.com/planer/?preview=1&rabcdef123456#p/AbCdEfGhIjKlMn_o",
  );
  assert.equal(
    withReleaseQuery("https://example.com/planer/#plan=legacy", "dev"),
    "https://example.com/planer/#plan=legacy",
  );
});

test("nowsze wydanie omija cache HTML i nie gubi udostępnionej trasy", async () => {
  let replaced = "";
  let requested = null;
  const locationRef = {
    href: "https://example.com/zabhop/planer-energylandia/#p/AbCdEfGhIjKlMn_o",
    replace(value) { replaced = value; },
  };
  const result = await checkForAppUpdate({
    release: "0123456789ab",
    locationRef,
    storage: fakeStorage(),
    now: 1_234_567,
    fetchImpl: async (url, options) => {
      requested = { url, options };
      return { ok: true, json: async () => ({ release: "ABCDEF123456" }) };
    },
  });

  assert.deepEqual(result, { state: "updating", release: "abcdef123456" });
  assert.match(requested.url, /\/planer-energylandia\/release\.json\?check=1234567$/);
  assert.equal(requested.options.cache, "no-store");
  assert.equal(
    replaced,
    "https://example.com/zabhop/planer-energylandia/?rabcdef123456#p/AbCdEfGhIjKlMn_o",
  );
});

test("sprawdzanie nie zapętla przeładowania ani nie przeszkadza przy awarii sieci", async () => {
  let replacements = 0;
  const locationRef = {
    href: "https://example.com/planer/#p/AbCdEfGhIjKlMn_o",
    replace() { replacements += 1; },
  };
  const storage = fakeStorage();
  const fetchImpl = async () => ({ ok: true, json: async () => ({ release: "abcdef123456" }) });

  assert.equal((await checkForAppUpdate({ release: "0123456789ab", locationRef, storage, fetchImpl, now: 10_000 })).state, "updating");
  assert.equal((await checkForAppUpdate({ release: "0123456789ab", locationRef, storage, fetchImpl, now: 10_100 })).state, "throttled");
  assert.equal((await checkForAppUpdate({ release: "abcdef123456", locationRef, storage, fetchImpl, now: 10_200 })).state, "current");
  assert.equal((await checkForAppUpdate({
    release: "0123456789ab",
    locationRef,
    storage,
    fetchImpl: async () => { throw new Error("offline"); },
  })).state, "unavailable");
  assert.equal(replacements, 1);
});

test("aktualizacja aplikacji reaguje na powrót iOS i nie sprawdza ukrytej karty", async () => {
  const windowHandlers = new Map();
  const documentHandlers = new Map();
  let checks = 0;
  let intervalCallback = null;
  let clearedInterval = null;
  const windowRef = {
    addEventListener(name, handler) { windowHandlers.set(name, handler); },
    removeEventListener(name) { windowHandlers.delete(name); },
    setInterval(handler) { intervalCallback = handler; return 17; },
    clearInterval(value) { clearedInterval = value; },
  };
  const documentRef = {
    visibilityState: "visible",
    addEventListener(name, handler) { documentHandlers.set(name, handler); },
    removeEventListener(name) { documentHandlers.delete(name); },
  };
  const cleanup = startAppUpdateChecks({
    release: "0123456789ab",
    windowRef,
    documentRef,
    check: async () => { checks += 1; },
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(checks, 1);

  documentRef.visibilityState = "hidden";
  documentHandlers.get("visibilitychange")();
  intervalCallback();
  assert.equal(checks, 1);

  documentRef.visibilityState = "visible";
  documentHandlers.get("visibilitychange")();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(checks, 2);

  windowHandlers.get("pageshow")();
  await Promise.resolve();
  assert.equal(checks, 3);
  cleanup();
  assert.equal(clearedInterval, 17);
  assert.equal(windowHandlers.has("pageshow"), false);
  assert.equal(documentHandlers.has("visibilitychange"), false);
});
