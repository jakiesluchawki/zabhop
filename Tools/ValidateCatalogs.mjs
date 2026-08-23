#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const minimumStoreCount = 10_000;
const definitions = [
  { name: "Żabka", catalog: "stores.json", manifest: "stores-manifest.json", format: "array" },
  { name: "Inne sklepy", catalog: "other-stores.json", manifest: "other-stores-manifest.json", format: "object" }
];

function fail(message) {
  throw new Error(message);
}

function validateHours(hours, label) {
  if (hours == null) return;
  if (!Array.isArray(hours) || hours.length !== 7) {
    fail(`${label}: opening hours must contain exactly seven days`);
  }
  for (const day of hours) {
    if (day == null || day === "") continue;
    if (typeof day !== "string" || !/^(?:\d{1,4}-\d{1,4})(?:,\d{1,4}-\d{1,4})*$/.test(day)) {
      fail(`${label}: invalid opening-hours interval`);
    }
    for (const interval of day.split(",")) {
      const [start, end] = interval.split("-").map(Number);
      if (start < 0 || end > 1_440 || end <= start) {
        fail(`${label}: opening-hours interval is outside a single day`);
      }
    }
  }
}

function validateDefinition(definition) {
  const catalogPath = path.join(root, definition.catalog);
  const nativePath = path.join(root, "ZabHop", "Resources", definition.catalog);
  const manifestPath = path.join(root, definition.manifest);
  const catalogData = fs.readFileSync(catalogPath);
  const nativeData = fs.readFileSync(nativePath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const rows = JSON.parse(catalogData.toString("utf8"));

  if (!Array.isArray(rows)) fail(`${definition.name}: catalog must be a JSON array`);
  if (manifest.schemaVersion !== 1) fail(`${definition.name}: unsupported manifest schema`);
  if (manifest.catalogPath !== definition.catalog) fail(`${definition.name}: manifest catalog path mismatch`);
  if (!Number.isFinite(Date.parse(manifest.generatedAt))) fail(`${definition.name}: invalid generatedAt timestamp`);
  if (!Number.isInteger(manifest.storeCount) || manifest.storeCount !== rows.length) {
    fail(`${definition.name}: manifest store count does not match catalog`);
  }
  if (rows.length < minimumStoreCount) fail(`${definition.name}: suspiciously small catalog (${rows.length})`);
  if (!/^[a-f0-9]{64}$/.test(manifest.sha256)) fail(`${definition.name}: invalid SHA-256 digest`);

  const actualDigest = createHash("sha256").update(catalogData).digest("hex");
  if (actualDigest !== manifest.sha256) fail(`${definition.name}: SHA-256 digest mismatch`);
  if (!catalogData.equals(nativeData)) fail(`${definition.name}: bundled iOS catalog differs from root catalog`);

  const ids = new Set();
  let confirmedHours = 0;
  for (const row of rows) {
    const isArray = Array.isArray(row);
    if ((definition.format === "array") !== isArray) fail(`${definition.name}: unexpected catalog record format`);
    if (!isArray && (row == null || typeof row !== "object")) fail(`${definition.name}: invalid catalog record`);

    const id = isArray ? row[0] : row.id;
    const latitude = isArray ? row[1] : row.lat;
    const longitude = isArray ? row[2] : row.lon;
    const hours = isArray ? row[5] : row.hours;
    if (typeof id !== "string" || id.length === 0) fail(`${definition.name}: missing store identifier`);
    if (ids.has(id)) fail(`${definition.name}: duplicate store identifier ${id}`);
    ids.add(id);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
        || latitude < 48 || latitude > 56 || longitude < 13 || longitude > 25) {
      fail(`${definition.name}: invalid coordinates for ${id}`);
    }
    validateHours(hours, `${definition.name} ${id}`);
    if (Array.isArray(hours)) confirmedHours += 1;
  }

  return {
    name: definition.name,
    stores: rows.length,
    withHours: confirmedHours,
    bytes: catalogData.byteLength,
    sha256: actualDigest,
    generatedAt: manifest.generatedAt
  };
}

const selector = process.argv.includes("--zabka")
  ? "stores.json"
  : process.argv.includes("--other")
    ? "other-stores.json"
    : null;

const results = definitions
  .filter((definition) => selector == null || definition.catalog === selector)
  .map(validateDefinition);

console.log(JSON.stringify({ valid: true, catalogs: results }, null, 2));
