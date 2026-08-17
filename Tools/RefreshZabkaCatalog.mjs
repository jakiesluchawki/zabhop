#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const webDirectory = fs.existsSync(path.join(root, "web", "store-hours.js"))
  ? path.join(root, "web")
  : root;
const nativeResources = path.join(root, "ZabHop", "Resources");
const require = createRequire(import.meta.url);
const { normalizeOfficialHours } = require(path.join(webDirectory, "store-hours.js"));
const officialURL = "https://www.zabka.pl/app/uploads/locator-store-data.json";
const retryDelaysMs = [5_000, 15_000, 45_000];
const retryableStatuses = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function loadOfficial() {
  const local = process.env.ZABHOP_OFFICIAL_INPUT;
  if (local) return JSON.parse(fs.readFileSync(local, "utf8"));

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    let response;
    try {
      response = await fetch(officialURL, {
        headers: {
          Accept: "application/json",
          Referer: "https://www.zabka.pl/znajdz-sklep/",
          "User-Agent": "ZabHop catalog refresh (https://github.com/jakiesluchawki/zabhop)"
        }
      });
    } catch (error) {
      if (attempt >= retryDelaysMs.length) throw error;
      const delay = retryDelaysMs[attempt];
      console.warn(`Official Żabka feed request failed; retrying in ${delay / 1000}s`);
      await wait(delay);
      continue;
    }
    if (response.ok) return response.json();

    const shouldRetry = retryableStatuses.has(response.status) && attempt < retryDelaysMs.length;
    if (!shouldRetry) throw new Error(`Official Żabka feed returned HTTP ${response.status}`);

    await response.body?.cancel();
    const delay = retryDelaysMs[attempt];
    console.warn(`Official Żabka feed returned HTTP ${response.status}; retrying in ${delay / 1000}s`);
    await wait(delay);
  }

  throw new Error("Official Żabka feed could not be loaded");
}

function cleanAddress(value) {
  return String(value || "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCurrentStore(store) {
  const active = store?.active === true || String(store?.active).toLowerCase() === "true";
  return active
    && store?.isVisible !== false
    && store?.locatorPlanned !== true
    && typeof store?.storeId === "string"
    && Number.isFinite(Number(store?.lat))
    && Number.isFinite(Number(store?.lon));
}

const official = await loadOfficial();
if (!Array.isArray(official)) throw new Error("Official Żabka feed is not an array");

const rows = official
  .filter(isCurrentStore)
  .map((store) => [
    store.storeId,
    Number(store.lat),
    Number(store.lon),
    cleanAddress(store.street),
    cleanAddress(store.town),
    normalizeOfficialHours(store.openingHours)
  ])
  .sort((lhs, rhs) => lhs[0].localeCompare(rhs[0], "pl"));

const uniqueIds = new Set(rows.map((row) => row[0]));
if (rows.length < 10_000 || uniqueIds.size !== rows.length) {
  throw new Error(`Refusing suspicious catalog: ${rows.length} rows, ${uniqueIds.size} unique IDs`);
}

const previous = JSON.parse(fs.readFileSync(path.join(webDirectory, "stores.json"), "utf8"));
if (rows.length < previous.length * 0.9) {
  throw new Error(`Refusing catalog shrink from ${previous.length} to ${rows.length}`);
}

const serialized = JSON.stringify(rows);
const catalogData = Buffer.from(serialized);
const manifestPath = path.join(webDirectory, "stores-manifest.json");
const previousManifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  : null;
const sha256 = createHash("sha256").update(catalogData).digest("hex");
const manifest = {
  schemaVersion: 1,
  generatedAt: previousManifest?.sha256 === sha256
    ? previousManifest.generatedAt
    : new Date().toISOString(),
  sha256,
  storeCount: rows.length,
  catalogPath: "stores.json"
};

fs.writeFileSync(path.join(webDirectory, "stores.json"), catalogData);
fs.writeFileSync(path.join(nativeResources, "stores.json"), catalogData);
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({
  source: officialURL,
  sourceRows: official.length,
  publishedRows: rows.length,
  bytes: catalogData.length,
  manifest
}, null, 2));
