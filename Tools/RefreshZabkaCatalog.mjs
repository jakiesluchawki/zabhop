#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { officialURL, buildOfficialCatalog, fetchOfficialCatalog } from "./zabka-catalog-source.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const webDirectory = fs.existsSync(path.join(root, "web", "store-hours.js"))
  ? path.join(root, "web")
  : root;
const nativeResources = path.join(root, "ZabHop", "Resources");
const require = createRequire(import.meta.url);
const { normalizeOfficialHours } = require(path.join(webDirectory, "store-hours.js"));
const previous = JSON.parse(fs.readFileSync(path.join(webDirectory, "stores.json"), "utf8"));
const options = { previousCount: previous.length, normalizeHours: normalizeOfficialHours };
const local = process.env.ZABHOP_OFFICIAL_INPUT;
const result = local
  ? { ...buildOfficialCatalog(JSON.parse(fs.readFileSync(local, "utf8")), options), attempts: 1 }
  : await fetchOfficialCatalog(options);
const { rows, stats, attempts } = result;

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
  ...stats,
  attempts,
  publishedRows: rows.length,
  bytes: catalogData.length,
  manifest
}, null, 2));
