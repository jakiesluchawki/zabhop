#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(import.meta.url);
const { parseOsmOpeningHours } = require(path.join(root, "store-hours.js"));

const minimumStoreCount = 10_000;
const maximumShrinkRatio = 0.1;
const minimumKnownHoursRatio = 0.75;
const minimumChainRetentionRatio = 0.7;
const primaryRequestTimeoutMs = 75_000;
const backupRequestTimeoutMs = 25_000;
const maximumPrimaryRateLimitRetries = 2;
const defaultRateLimitRetryDelayMs = 7_000;
const minimumRateLimitRetryDelayMs = 5_000;
const maximumRateLimitRetryDelayMs = 60_000;
const interBatchDelayMs = 2_000;
const retryRounds = 2;
const publicCatalogPath = path.join(root, "other-stores.json");
const bundledCatalogPath = path.join(root, "ZabHop", "Resources", "other-stores.json");
const manifestPath = path.join(root, "other-stores-manifest.json");
const defaultEndpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
];

const chainDefinitions = [
  ["Delikatesy Centrum", /\bdelikatesy\s+centrum\b/i],
  ["Biedronka", /\bbiedronka\b/i],
  ["Carrefour", /\bcarrefour\b/i],
  ["Stokrotka", /\bstokrotka\b/i],
  ["Kaufland", /\bkaufland\b/i],
  ["Lewiatan", /\blewiatan\b/i],
  ["Auchan", /\bauchan\b/i],
  ["Netto", /\bnetto\b/i],
  ["Lidl", /\blidl\b/i],
  ["Dino", /\bdino\b/i],
  ["ALDI", /\baldi\b/i],
  ["SPAR", /\b(?:euro|inter)?spar\b/i]
];

export const overpassChainBatches = [
  { chain: "Kaufland", values: ["Kaufland"] },
  { chain: "Auchan", values: ["Auchan", "AUCHAN", "Auchan Supermarket", "Auchan Easy", "Easy Auchan"] },
  { chain: "ALDI", values: ["ALDI", "Aldi", "ALDI Nord", "Aldi Market"] },
  { chain: "SPAR", values: ["SPAR", "Spar", "SPAR Express", "Spar Express", "EUROSPAR", "Eurospar", "INTERSPAR", "Spar Mini"] },
  { chain: "Carrefour", values: ["Carrefour", "Carrefour Express", "Carrefour express", "Carrefour Market", "Carrefour Bio"] },
  { chain: "Netto", values: ["Netto", "Netto Marken-Discount"] },
  { chain: "Stokrotka", values: ["Stokrotka", "stokrotka", "Stokrotka Market", "Stokrotka Express", "Stokrotka Optima", "Stokrotka Supermarket"] },
  { chain: "Lidl", values: ["Lidl", "LIDL", "Lidl Outlet"] },
  { chain: "Delikatesy Centrum", values: ["Delikatesy Centrum", "delikatesy centrum"] },
  { chain: "Lewiatan", values: ["Lewiatan", "lewiatan", "PSH Lewiatan", "Lewiatan Express", "Lewiatan express", "Lewiatan Market"] },
  { chain: "Dino", values: ["Dino", "DINO", "Dino Market", "Dino market"] },
  { chain: "Biedronka", values: ["Biedronka", "BIEDRONKA", "Biedronka Outlet"] }
];

export function buildOverpassQuery(batch) {
  const values = [...new Set(batch.values)];
  const statements = values.flatMap((value) => {
    const safe = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return [
      `  nwr["shop"]["brand"="${safe}"](area.poland);`,
      `  nwr["shop"]["name"="${safe}"](area.poland);`
    ];
  });

  return `[out:json][timeout:60];
area["ISO3166-1"="PL"]["admin_level"="2"]->.poland;
(
${statements.join("\n")}
);
out center;
`;
}

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function parseExplicitDate(value) {
  const normalized = clean(value);
  let match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let year;
  let month;
  let day;
  if (match) {
    [, year, month, day] = match;
  } else {
    match = normalized.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!match) return null;
    [, day, month, year] = match;
  }
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year)
      || date.getUTCMonth() !== Number(month) - 1
      || date.getUTCDate() !== Number(day)) return null;
  return date.getTime();
}

function truthyLifecycle(value) {
  const normalized = clean(value);
  return normalized !== "" && !/^(?:no|false|0|none|completed)$/i.test(normalized);
}

export function osmId(element) {
  const prefixes = { node: "n", way: "w", relation: "r" };
  const prefix = prefixes[element?.type];
  if (!prefix || !Number.isSafeInteger(element.id) || element.id <= 0) return null;
  return `osm-${prefix}-${element.id}`;
}

export function detectChain(tags) {
  const candidates = [tags?.brand, tags?.name, tags?.operator]
    .map(clean)
    .filter(Boolean);
  for (const candidate of candidates) {
    const definition = chainDefinitions.find(([, pattern]) => pattern.test(candidate));
    if (definition) return definition[0];
  }
  return null;
}

export function isClearlyUnavailable(element, snapshotAt) {
  const tags = element?.tags || {};
  const lifecycleKeys = [
    "disused:shop", "abandoned:shop", "was:shop", "demolished:shop",
    "razed:shop", "removed:shop", "closed:shop", "construction:shop", "proposed:shop"
  ];
  if (lifecycleKeys.some((key) => truthyLifecycle(tags[key]))) return true;
  if (truthyLifecycle(tags.construction)) return true;
  if (/^(?:no|vacant|closed|disused|abandoned|construction)$/i.test(clean(tags.shop))) return true;
  if (clean(tags.access).toLowerCase() === "no") return true;
  if (/^(?:closed|off)$/i.test(clean(tags.opening_hours))) return true;

  const unavailableName = /(?:^|[\s([{/–—-])(?:nieczynna|nieczynny|nieczynne|zamknięta|zamknięty|zamknięte|temporarily closed|closed|w budowie)(?=$|[\s)\]}/–—-])/i;
  if (unavailableName.test(clean(tags.name))) return true;

  for (const key of ["start_date", "opening_date"]) {
    const date = parseExplicitDate(tags[key]);
    if (date != null && date > snapshotAt) return true;
    if (/^(?:w budowie|planowany|not yet open)$/i.test(clean(tags[key]))) return true;
  }
  const endDate = parseExplicitDate(tags.end_date);
  return endDate != null && endDate <= snapshotAt;
}

export function hasFreshAllDayEvidence(element, snapshotAt) {
  const tags = element?.tags || {};
  const checkedAt = [tags["check_date:opening_hours"], tags.check_date, tags["survey:date"]]
    .map(parseExplicitDate)
    .filter((date) => date != null)
    .sort((left, right) => right - left)[0];
  if (checkedAt == null) return false;
  const threshold = new Date(snapshotAt);
  threshold.setUTCMonth(threshold.getUTCMonth() - 24);
  return checkedAt >= threshold.getTime() && checkedAt <= snapshotAt;
}

function coordinateFor(element) {
  const latitude = Number(element.lat ?? element.center?.lat);
  const longitude = Number(element.lon ?? element.center?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < 48 || latitude > 56 || longitude < 13 || longitude > 25) {
    return null;
  }
  return { latitude, longitude };
}

function addressFor(tags) {
  const street = clean(tags["addr:street"]) || clean(tags["addr:place"]);
  const house = clean(tags["addr:housenumber"]);
  return [street, house].filter(Boolean).join(" ");
}

function countByChain(rows) {
  const counts = new Map();
  for (const row of rows) counts.set(row.chain, (counts.get(row.chain) || 0) + 1);
  return counts;
}

export function validateCatalog(rows, previousRows) {
  if (!Array.isArray(previousRows)) throw new Error("Existing other-store catalog is not an array");
  if (rows.length < minimumStoreCount) {
    throw new Error(`Refusing suspicious other-store catalog: only ${rows.length} stores`);
  }
  if (rows.length < previousRows.length * (1 - maximumShrinkRatio)) {
    throw new Error(`Refusing catalog shrink from ${previousRows.length} to ${rows.length}`);
  }

  const identifiers = new Set(rows.map((row) => row.id));
  if (identifiers.size !== rows.length) throw new Error("Refusing duplicate OSM store identifiers");

  const previousHours = previousRows.filter((row) => Array.isArray(row.hours)).length;
  const currentHours = rows.filter((row) => Array.isArray(row.hours)).length;
  if (previousHours && currentHours < previousHours * minimumKnownHoursRatio) {
    throw new Error(`Refusing opening-hours coverage shrink from ${previousHours} to ${currentHours}`);
  }

  const previousChains = countByChain(previousRows);
  const currentChains = countByChain(rows);
  for (const [chain, previousCount] of previousChains) {
    if (previousCount < 100) continue;
    const currentCount = currentChains.get(chain) || 0;
    if (currentCount < previousCount * minimumChainRetentionRatio) {
      throw new Error(`Refusing suspicious ${chain} shrink from ${previousCount} to ${currentCount}`);
    }
  }
}

export function catalogFromSnapshot(snapshot, previousRows) {
  if (!snapshot || !Array.isArray(snapshot.elements)) {
    throw new Error("Overpass response does not contain an elements array");
  }
  if (snapshot.remark) throw new Error(`Overpass returned an incomplete response: ${snapshot.remark}`);
  const timestamp = Date.parse(snapshot.osm3s?.timestamp_osm_base || "");
  const snapshotAt = Number.isFinite(timestamp) ? timestamp : Date.now();
  const rows = [];
  const summary = {
    sourceElements: snapshot.elements.length,
    removedUnavailable: 0,
    rejectedMissingLocation: 0,
    rejectedUnknownChain: 0,
    rejectedStaleAllDay: 0,
    trustedAllDay: 0,
    withHours: 0
  };

  for (const element of snapshot.elements) {
    const id = osmId(element);
    const coordinate = coordinateFor(element);
    if (!id || !coordinate) {
      summary.rejectedMissingLocation += 1;
      continue;
    }
    if (isClearlyUnavailable(element, snapshotAt)) {
      summary.removedUnavailable += 1;
      continue;
    }
    const tags = element.tags || {};
    const chain = detectChain(tags);
    if (!chain) {
      summary.rejectedUnknownChain += 1;
      continue;
    }

    const row = {
      id,
      name: clean(tags.name) || clean(tags.brand) || chain,
      chain,
      lat: coordinate.latitude,
      lon: coordinate.longitude,
      street: addressFor(tags),
      town: clean(tags["addr:city"])
        || clean(tags["addr:town"])
        || clean(tags["addr:village"])
        || clean(tags["is_in:city"])
    };

    let parsed = parseOsmOpeningHours(tags.opening_hours);
    const allDay = Array.isArray(parsed?.hours)
      && parsed.hours.length === 7
      && parsed.hours.every((day) => day === "0-1440");
    if (allDay && !hasFreshAllDayEvidence(element, snapshotAt)) {
      parsed = null;
      summary.rejectedStaleAllDay += 1;
    } else if (allDay) {
      summary.trustedAllDay += 1;
    }
    if (parsed) {
      row.hours = parsed.hours;
      if (parsed.holidaysClosed) row.holidaysClosed = true;
      summary.withHours += 1;
    }
    rows.push(row);
  }

  const collator = new Intl.Collator("pl", { sensitivity: "base", numeric: true });
  rows.sort((left, right) => collator.compare(left.chain, right.chain)
    || collator.compare(left.town, right.town)
    || collator.compare(left.street, right.street)
    || collator.compare(left.id, right.id));

  validateCatalog(rows, previousRows);
  return { rows, summary, snapshotAt: new Date(snapshotAt).toISOString() };
}

export function manifestFor(rows, data, previousManifest = null) {
  const sha256 = createHash("sha256").update(data).digest("hex");
  return {
    schemaVersion: 1,
    generatedAt: previousManifest?.sha256 === sha256
      ? previousManifest.generatedAt
      : new Date().toISOString(),
    sha256,
    storeCount: rows.length,
    catalogPath: "other-stores.json"
  };
}

function configuredEndpoints() {
  const endpoints = process.env.ZABHOP_OVERPASS_URL
    ? [process.env.ZABHOP_OVERPASS_URL, ...defaultEndpoints]
    : defaultEndpoints;
  return [...new Set(endpoints)];
}

function pauseFor(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function overpassRetryDelay(response, now = Date.now()) {
  const retryAfter = response.headers?.get("retry-after")?.trim();
  if (!retryAfter) return defaultRateLimitRetryDelayMs;

  let milliseconds;
  if (/^\d+$/.test(retryAfter)) {
    milliseconds = Number(retryAfter) * 1_000;
  } else {
    const deadline = Date.parse(retryAfter);
    if (!Number.isFinite(deadline)) return defaultRateLimitRetryDelayMs;
    milliseconds = deadline - now;
  }

  if (!Number.isFinite(milliseconds)) return defaultRateLimitRetryDelayMs;
  return Math.min(
    maximumRateLimitRetryDelayMs,
    Math.max(minimumRateLimitRetryDelayMs, milliseconds)
  );
}

export function mergeOverpassSnapshots(results) {
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error("No successful Overpass batches are available to merge");
  }

  const elements = new Map();
  const timestamps = [];
  for (const result of results) {
    const snapshot = result.snapshot || result;
    if (!Array.isArray(snapshot.elements)) {
      throw new Error("An Overpass batch is missing its elements array");
    }
    if (snapshot.remark) throw new Error(`Overpass returned an incomplete batch: ${snapshot.remark}`);
    const timestamp = Date.parse(snapshot.osm3s?.timestamp_osm_base || "");
    if (Number.isFinite(timestamp)) timestamps.push(timestamp);

    for (const element of snapshot.elements) {
      const id = osmId(element);
      if (!id) continue;
      const previous = elements.get(id);
      if (!previous || Object.keys(element.tags || {}).length > Object.keys(previous.tags || {}).length) {
        elements.set(id, element);
      }
    }
  }

  return {
    osm3s: {
      timestamp_osm_base: new Date(timestamps.length ? Math.max(...timestamps) : Date.now()).toISOString()
    },
    elements: [...elements.values()]
  };
}

export async function fetchChainBatch(batch, position, total, options = {}) {
  const endpoints = options.endpoints || configuredEndpoints();
  const fetchImplementation = options.fetchImplementation || fetch;
  const pause = options.pause || pauseFor;
  const currentTime = options.now || Date.now;
  const failures = [];

  for (let round = 0; round < retryRounds; round += 1) {
    for (const [endpointIndex, endpoint] of endpoints.entries()) {
      const host = new URL(endpoint).host;
      const timeoutMs = endpointIndex === 0 ? primaryRequestTimeoutMs : backupRequestTimeoutMs;
      const maximumAttempts = endpointIndex === 0 ? maximumPrimaryRateLimitRetries + 1 : 1;

      for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
        try {
          console.log(`[${position}/${total}] Fetching ${batch.chain} from ${host}`);
          const response = await fetchImplementation(endpoint, {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              "User-Agent": "ZabHop weekly catalog refresh (https://github.com/jakiesluchawki/zabhop)"
            },
            body: new URLSearchParams({ data: buildOverpassQuery(batch) }),
            signal: AbortSignal.timeout(timeoutMs)
          });
          if (!response.ok) {
            const shouldRetryHere = endpointIndex === 0
              && [429, 502, 503, 504].includes(response.status)
              && attempt + 1 < maximumAttempts;
            const retryDelay = shouldRetryHere ? overpassRetryDelay(response, currentTime()) : null;
            await response.body?.cancel();

            if (shouldRetryHere) {
              console.warn(
                `${host} temporarily limited ${batch.chain} (HTTP ${response.status}); `
                + `retrying the primary provider in ${retryDelay / 1_000}s `
                + `(${attempt + 1}/${maximumPrimaryRateLimitRetries})`
              );
              await pause(retryDelay);
              continue;
            }

            throw new Error(`HTTP ${response.status}`);
          }
          const snapshot = await response.json();
          if (!Array.isArray(snapshot.elements)) throw new Error("response is missing store elements");
          if (snapshot.elements.length === 0) throw new Error("response contains no stores for this chain");
          if (snapshot.remark) throw new Error(`incomplete response: ${snapshot.remark}`);
          console.log(`[${position}/${total}] ${batch.chain}: ${snapshot.elements.length} OpenStreetMap records`);
          return { chain: batch.chain, source: endpoint, snapshot };
        } catch (error) {
          const reason = `${host}: ${error.message}`;
          failures.push(reason);
          console.warn(`OpenStreetMap batch ${batch.chain} failed; ${reason}`);
          break;
        }
      }
    }
    if (round + 1 < retryRounds) {
      const delay = (round + 1) * 3_000;
      console.warn(`Retrying ${batch.chain} on all Overpass providers in ${delay / 1_000}s`);
      await pause(delay);
    }
  }

  throw new Error(`Every Overpass provider failed for ${batch.chain}: ${failures.join("; ")}`);
}

export async function fetchOverpassBatches(options = {}) {
  const batches = options.batches || overpassChainBatches;
  const fetchBatch = options.fetchBatch || fetchChainBatch;
  const pause = options.pause || pauseFor;
  const batchDelay = options.batchDelayMs ?? interBatchDelayMs;
  const results = [];

  for (const [index, batch] of batches.entries()) {
    if (index > 0) await pause(batchDelay);
    results.push(await fetchBatch(batch, index + 1, batches.length));
  }

  return results;
}

async function loadSnapshot() {
  const localPath = process.env.ZABHOP_OVERPASS_INPUT;
  if (localPath) return {
    source: localPath,
    snapshot: JSON.parse(fs.readFileSync(localPath, "utf8"))
  };

  const results = await fetchOverpassBatches();

  return {
    source: [...new Set(results.map((result) => result.source))].join(", "),
    snapshot: mergeOverpassSnapshots(results),
    batches: results.map(({ chain, source, snapshot }) => ({
      chain,
      source: new URL(source).host,
      elements: snapshot.elements.length
    }))
  };
}

export async function refreshCatalog() {
  const previousRows = JSON.parse(fs.readFileSync(publicCatalogPath, "utf8"));
  const previousManifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : null;
  const { source, snapshot, batches } = await loadSnapshot();
  const { rows, summary, snapshotAt } = catalogFromSnapshot(snapshot, previousRows);
  const data = Buffer.from(JSON.stringify(rows));
  const manifest = manifestFor(rows, data, previousManifest);

  fs.writeFileSync(publicCatalogPath, data);
  fs.writeFileSync(bundledCatalogPath, data);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(JSON.stringify({
    source,
    ...(batches ? { batches } : {}),
    snapshotAt,
    publishedRows: rows.length,
    bytes: data.length,
    coveragePercent: Number((summary.withHours / rows.length * 100).toFixed(1)),
    ...summary,
    manifest
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const probeIndex = process.argv.indexOf("--probe-chain");
  if (probeIndex !== -1) {
    const requestedChain = process.argv[probeIndex + 1];
    const batch = overpassChainBatches.find(({ chain }) => chain.toLowerCase() === requestedChain?.toLowerCase());
    if (!batch) throw new Error(`Unknown chain for an Overpass probe: ${requestedChain || "missing"}`);
    const result = await fetchChainBatch(batch, 1, 1);
    console.log(JSON.stringify({
      probe: true,
      chain: result.chain,
      source: new URL(result.source).host,
      records: result.snapshot.elements.length,
      snapshotAt: result.snapshot.osm3s?.timestamp_osm_base || null
    }, null, 2));
  } else {
    await refreshCatalog();
  }
}
