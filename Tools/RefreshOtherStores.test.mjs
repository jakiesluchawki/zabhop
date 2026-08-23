import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOverpassQuery,
  catalogFromSnapshot,
  detectChain,
  fetchChainBatch,
  fetchOverpassBatches,
  hasFreshAllDayEvidence,
  isClearlyUnavailable,
  manifestFor,
  mergeOverpassSnapshots,
  osmId,
  overpassChainBatches,
  overpassRetryDelay,
  validateCatalog
} from "./RefreshOtherStores.mjs";

const snapshotTimestamp = "2026-08-23T08:00:00.000Z";
const snapshotAt = Date.parse(snapshotTimestamp);

function element(id, tags = {}) {
  return {
    type: "node",
    id,
    lat: 52.2 + (id % 100) / 10_000,
    lon: 21.0 + (id % 100) / 10_000,
    tags: { shop: "supermarket", name: "Biedronka", ...tags }
  };
}

function snapshotWith(overrides = []) {
  const elements = Array.from({ length: 10_020 }, (_, index) => element(index + 1, {
    opening_hours: "Mo-Sa 06:00-22:00; Su off"
  }));
  for (const [index, replacement] of overrides.entries()) elements[index] = replacement;
  return { osm3s: { timestamp_osm_base: snapshotTimestamp }, elements };
}

test("recognizes supported chains, coordinates and stable OSM IDs", () => {
  assert.equal(detectChain({ brand: "ALDI Nord" }), "ALDI");
  assert.equal(detectChain({ name: "Carrefour Express" }), "Carrefour");
  assert.equal(detectChain({ operator: "Delikatesy Centrum" }), "Delikatesy Centrum");
  assert.equal(detectChain({ name: "EUROSPAR" }), "SPAR");
  assert.equal(detectChain({ name: "Dinozaur zabawki" }), null);
  assert.equal(osmId({ type: "way", id: 123 }), "osm-w-123");
  assert.equal(osmId({ type: "relation", id: 321 }), "osm-r-321");
});

test("queries each store chain using exact indexed OSM tags instead of global regex scans", () => {
  const kaufland = overpassChainBatches.find((batch) => batch.chain === "Kaufland");
  const query = buildOverpassQuery(kaufland);
  assert.match(query, /\["brand"="Kaufland"\]/);
  assert.match(query, /\["name"="Kaufland"\]/);
  assert.doesNotMatch(query, /\["(?:brand|name|operator)"~/);
  assert.doesNotMatch(query, /Biedronka|Carrefour|Stokrotka/);
  assert.equal(overpassChainBatches.length, 12);
});

test("honors safe Retry-After delays without busy loops or unbounded waits", () => {
  const now = Date.parse("2026-08-23T08:00:00.000Z");
  const response = (retryAfter) => new Response("", {
    status: 429,
    headers: retryAfter == null ? {} : { "Retry-After": retryAfter }
  });

  assert.equal(overpassRetryDelay(response(null), now), 7_000);
  assert.equal(overpassRetryDelay(response("9"), now), 9_000);
  assert.equal(overpassRetryDelay(response("0"), now), 5_000);
  assert.equal(overpassRetryDelay(response("999"), now), 60_000);
  assert.equal(overpassRetryDelay(response("nonsense"), now), 7_000);
  assert.equal(
    overpassRetryDelay(response("Sun, 23 Aug 2026 08:00:12 GMT"), now),
    12_000
  );
});

test("retries primary Overpass provider after temporary throttling before using backups", async () => {
  const batch = overpassChainBatches[0];
  const primary = "https://primary.example/api/interpreter";
  const backup = "https://backup.example/api/interpreter";
  const calls = [];
  const pauses = [];
  const responses = [
    new Response("", { status: 429, headers: { "Retry-After": "8" } }),
    new Response("", { status: 503 }),
    Response.json({ elements: [element(1)] })
  ];

  const result = await fetchChainBatch(batch, 1, 12, {
    endpoints: [primary, backup],
    fetchImplementation: async (endpoint) => {
      calls.push(endpoint);
      return responses.shift();
    },
    pause: async (delay) => pauses.push(delay)
  });

  assert.equal(result.source, primary);
  assert.equal(result.snapshot.elements.length, 1);
  assert.deepEqual(calls, [primary, primary, primary]);
  assert.deepEqual(pauses, [8_000, 7_000]);
});

test("retries transient primary gateway failures before using backups", async () => {
  const batch = overpassChainBatches[0];
  const primary = "https://primary.example/api/interpreter";
  const backup = "https://backup.example/api/interpreter";

  for (const status of [502, 504]) {
    const calls = [];
    const pauses = [];

    const result = await fetchChainBatch(batch, 1, 12, {
      endpoints: [primary, backup],
      fetchImplementation: async (endpoint) => {
        calls.push(endpoint);
        return calls.length === 1
          ? new Response("", { status })
          : Response.json({ elements: [element(1)] });
      },
      pause: async (delay) => pauses.push(delay)
    });

    assert.equal(result.source, primary);
    assert.deepEqual(calls, [primary, primary], `HTTP ${status} should stay on the primary provider`);
    assert.deepEqual(pauses, [7_000]);
  }
});

test("falls back after bounded primary rate-limit retries", async () => {
  const batch = overpassChainBatches[0];
  const primary = "https://primary.example/api/interpreter";
  const backup = "https://backup.example/api/interpreter";
  const calls = [];
  const pauses = [];

  const result = await fetchChainBatch(batch, 1, 12, {
    endpoints: [primary, backup],
    fetchImplementation: async (endpoint) => {
      calls.push(endpoint);
      return endpoint === primary
        ? new Response("", { status: 429 })
        : Response.json({ elements: [element(1)] });
    },
    pause: async (delay) => pauses.push(delay)
  });

  assert.equal(result.source, backup);
  assert.deepEqual(calls, [primary, primary, primary, backup]);
  assert.deepEqual(pauses, [7_000, 7_000]);
});

test("paces consecutive chain batches without delaying the first request", async () => {
  const batches = overpassChainBatches.slice(0, 3);
  const events = [];

  const results = await fetchOverpassBatches({
    batches,
    fetchBatch: async (batch, position, total) => {
      events.push(["fetch", batch.chain, position, total]);
      return { chain: batch.chain, snapshot: { elements: [element(position)] } };
    },
    pause: async (delay) => events.push(["pause", delay])
  });

  assert.equal(results.length, 3);
  assert.deepEqual(events, [
    ["fetch", batches[0].chain, 1, 3],
    ["pause", 2_000],
    ["fetch", batches[1].chain, 2, 3],
    ["pause", 2_000],
    ["fetch", batches[2].chain, 3, 3]
  ]);
});

test("deduplicates stores returned by overlapping chain batches before final validation", () => {
  const shared = element(1, { brand: "Carrefour", name: "Lewiatan" });
  const first = {
    osm3s: { timestamp_osm_base: "2026-08-23T08:00:00.000Z" },
    elements: [shared, element(2)]
  };
  const second = {
    osm3s: { timestamp_osm_base: "2026-08-23T08:01:00.000Z" },
    elements: [shared, element(3)]
  };
  const merged = mergeOverpassSnapshots([{ snapshot: first }, { snapshot: second }]);
  assert.equal(merged.elements.length, 3);
  assert.equal(merged.osm3s.timestamp_osm_base, "2026-08-23T08:01:00.000Z");
  assert.throws(() => mergeOverpassSnapshots([]), /No successful Overpass batches/);
});

test("rejects closed, future and inaccessible stores", () => {
  assert.equal(isClearlyUnavailable(element(1, { "disused:shop": "supermarket" }), snapshotAt), true);
  assert.equal(isClearlyUnavailable(element(1, { opening_date: "2026-12-01" }), snapshotAt), true);
  assert.equal(isClearlyUnavailable(element(1, { access: "no" }), snapshotAt), true);
  assert.equal(isClearlyUnavailable(element(1, { name: "Biedronka (nieczynna)" }), snapshotAt), true);
  assert.equal(isClearlyUnavailable(element(1, { end_date: "2026-08-20" }), snapshotAt), true);
  assert.equal(isClearlyUnavailable(element(1), snapshotAt), false);
});

test("trusts 24/7 only after a recent, non-future survey", () => {
  const fresh = element(1, { opening_hours: "24/7", "check_date:opening_hours": "2026-08-20" });
  const stale = element(2, { opening_hours: "24/7", check_date: "2023-08-20" });
  const future = element(3, { opening_hours: "24/7", check_date: "2027-08-20" });
  const undated = element(4, { opening_hours: "24/7" });

  assert.equal(hasFreshAllDayEvidence(fresh, snapshotAt), true);
  assert.equal(hasFreshAllDayEvidence(stale, snapshotAt), false);
  assert.equal(hasFreshAllDayEvidence(future, snapshotAt), false);
  assert.equal(hasFreshAllDayEvidence(undated, snapshotAt), false);

  const { rows, summary } = catalogFromSnapshot(snapshotWith([fresh, stale, future, undated]), []);
  assert.deepEqual(rows.find((row) => row.id === "osm-n-1").hours, Array(7).fill("0-1440"));
  for (const id of [2, 3, 4]) {
    assert.equal(Object.hasOwn(rows.find((row) => row.id === `osm-n-${id}`), "hours"), false);
  }
  assert.equal(summary.trustedAllDay, 1);
  assert.equal(summary.rejectedStaleAllDay, 3);
});

test("preserves validated hours, holiday rules and structured addresses", () => {
  const store = element(1, {
    name: "Biedronka Warszawa",
    "addr:street": "Puławska",
    "addr:housenumber": "17A",
    "addr:city": "Warszawa",
    opening_hours: "Mo-Sa 06:00-22:00; Su,PH off"
  });
  const { rows } = catalogFromSnapshot(snapshotWith([store]), []);
  const row = rows.find((candidate) => candidate.id === "osm-n-1");
  assert.equal(row.street, "Puławska 17A");
  assert.equal(row.town, "Warszawa");
  assert.deepEqual(row.hours, Array(6).fill("360-1320").concat(""));
  assert.equal(row.holidaysClosed, true);
});

test("refuses small catalogs, duplicates and suspicious data loss", () => {
  assert.throws(() => validateCatalog([], []), /only 0 stores/);
  const rows = Array.from({ length: 10_000 }, (_, index) => ({
    id: `osm-n-${index + 1}`,
    chain: "Biedronka"
  }));
  assert.throws(() => validateCatalog(rows, Array(12_000).fill({ chain: "Biedronka" })), /catalog shrink/);
  const duplicated = [...rows];
  duplicated[1] = duplicated[0];
  assert.throws(() => validateCatalog(duplicated, []), /duplicate/);
  const previousWithHours = rows.map((row) => ({ ...row, hours: Array(7).fill("360-1320") }));
  assert.throws(() => validateCatalog(rows, previousWithHours), /opening-hours coverage/);
});

test("manifest is stable for identical content and matches the iOS contract", () => {
  const rows = [{ id: "osm-n-1" }];
  const data = Buffer.from(JSON.stringify(rows));
  const first = manifestFor(rows, data);
  const previous = { ...first, generatedAt: "2026-07-12T06:02:20.000Z" };
  const repeated = manifestFor(rows, data, previous);
  assert.equal(repeated.generatedAt, previous.generatedAt);
  assert.equal(repeated.schemaVersion, 1);
  assert.equal(repeated.catalogPath, "other-stores.json");
  assert.equal(repeated.storeCount, 1);
  assert.match(repeated.sha256, /^[a-f0-9]{64}$/);
});
