import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildOfficialCatalog, fetchOfficialCatalog, officialURL } from "./zabka-catalog-source.mjs";

const require = createRequire(import.meta.url);
const { normalizeOfficialHours } = require("../store-hours.js");
const options = { previousCount: 13_300, normalizeHours: normalizeOfficialHours };
const feed = (count = 13_302) => Array.from({ length: count }, (_, i) => ({
  storeId: `Z${String(i).padStart(5, "0")}`, active: "true", isVisible: true,
  lat: 52, lon: 19, street: "Test<br>  1", town: "Testowo",
  openingHours: { "mon-sat": "06:00:00 - 23:00:00", sun: "09:00:00 - 20:00:00" }
}));
const ok = (data = feed()) => ({ ok: true, json: async () => data });

function harness(responses, overrides = {}) {
  const calls = [], delays = [], warnings = [];
  return {
    calls, delays, warnings,
    run: () => fetchOfficialCatalog({ ...options, retryDelaysMs: [5, 15, 45],
      sleep: async (ms) => delays.push(ms), onRetry: (text) => warnings.push(text), now: () => 123,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        const response = responses[Math.min(calls.length - 1, responses.length - 1)];
        if (response instanceof Error) throw response;
        return response;
      }, ...overrides })
  };
}

test("partial HTTP 200 catalog is retried with a fresh cache key before publication", async () => {
  const h = harness([ok(feed(6485)), ok()]);
  const result = await h.run();
  assert.equal(result.rows.length, 13_302);
  assert.equal(result.attempts, 2);
  assert.deepEqual(h.delays, [5]);
  assert.equal(h.calls[0].url, officialURL);
  assert.equal(new URL(h.calls[1].url).searchParams.get("_zabhop_retry"), "123-1");
  assert.equal(h.calls[1].init.headers["Cache-Control"], "no-cache");
  assert.ok(h.calls[0].init.signal instanceof AbortSignal);
  assert.match(h.warnings[0], /6485/);
});

test("persistent partial catalogs exhaust four attempts without lowering the guard", async () => {
  const h = harness([ok(feed(6485))]);
  await assert.rejects(h.run(), /Refusing suspicious catalog.*6485/);
  assert.equal(h.calls.length, 4);
  assert.deepEqual(h.delays, [5, 15, 45]);
  assert.equal(new Set(h.calls.map(({ url }) => url)).size, 4);
});

test("rejects significant shrink, invalid shapes, duplicate IDs and invalid coordinates", () => {
  assert.throws(() => buildOfficialCatalog(feed(11_000), options), /shrink/);
  assert.throws(() => buildOfficialCatalog({}, options), /not an array/);
  for (const patch of [{ storeId: "" }, { lat: null }, { lon: "" }, { lat: "oops" }, { lon: 30 }]) {
    const records = feed(); Object.assign(records[0], patch);
    assert.throws(() => buildOfficialCatalog(records, options), /invalid IDs or coordinates/);
  }
  const duplicate = feed(); duplicate[0].storeId = duplicate[1].storeId;
  assert.throws(() => buildOfficialCatalog(duplicate, options), /unique IDs/);
});

test("normalizes active flags and excludes hidden, planned and inactive stores", () => {
  const records = feed();
  records[0].active = true;
  records.push(...[
    { active: false }, { active: "false" }, { isVisible: false },
    { isVisible: "false" }, { locatorPlanned: true }, { locatorPlanned: "true" }
  ].map((patch, i) => ({ ...records[0], storeId: `excluded-${i}`, ...patch })));
  const result = buildOfficialCatalog(records, options);
  assert.equal(result.rows.length, 13_302);
  assert.equal(result.rows[0][3], "Test 1");
  assert.deepEqual(result.rows[0][5], normalizeOfficialHours(records[0].openingHours));
});

test("retries transient HTTP and network errors, but not HTTP 404", async () => {
  for (const status of [403, 408, 429, 500, 502, 503, 504]) {
    let cancelled = false;
    const h = harness([{ ok: false, status, body: { cancel: async () => { cancelled = true; } } }, ok()]);
    assert.equal((await h.run()).attempts, 2);
    assert.equal(cancelled, true);
  }
  assert.equal((await harness([new Error("network unavailable"), ok()]).run()).attempts, 2);
  const h = harness([{ ok: false, status: 404 }]);
  await assert.rejects(h.run(), /HTTP 404/);
  assert.equal(h.calls.length, 1);
});

test("invalid JSON is retried without leaking source snippets to logs", async () => {
  const bad = { ok: true, json: async () => { throw new SyntaxError("private source snippet"); } };
  const h = harness([bad, ok()]);
  assert.equal((await h.run()).attempts, 2);
  assert.match(h.warnings[0], /invalid JSON/);
  assert.doesNotMatch(h.warnings[0], /private/);
  await assert.rejects(harness([bad]).run(), /invalid JSON/);
});

test("rejected import leaves existing web, native and manifest files untouched", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "zabhop-catalog-test-"));
  try {
    fs.mkdirSync(path.join(temp, "Tools"));
    fs.mkdirSync(path.join(temp, "ZabHop/Resources"), { recursive: true });
    for (const file of ["Tools/RefreshZabkaCatalog.mjs", "Tools/zabka-catalog-source.mjs", "store-hours.js",
      "stores.json", "stores-manifest.json", "ZabHop/Resources/stores.json"]) {
      fs.copyFileSync(path.join(root, file), path.join(temp, file));
    }
    const protectedFiles = ["stores.json", "stores-manifest.json", "ZabHop/Resources/stores.json"];
    const before = protectedFiles.map((file) => fs.readFileSync(path.join(temp, file)));
    const input = path.join(temp, "partial.json");
    fs.writeFileSync(input, JSON.stringify(feed(6485)));
    const run = spawnSync(process.execPath, ["Tools/RefreshZabkaCatalog.mjs"], {
      cwd: temp, env: { ...process.env, ZABHOP_OFFICIAL_INPUT: input }, encoding: "utf8"
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Refusing suspicious catalog/);
    protectedFiles.forEach((file, i) => assert.deepEqual(fs.readFileSync(path.join(temp, file)), before[i]));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
