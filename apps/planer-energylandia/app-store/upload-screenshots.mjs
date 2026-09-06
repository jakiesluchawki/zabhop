import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { api, bundleId, privateDirectory, save } from './asc.mjs';
import { APP_ID, VERSION_ID, VERSION, LOCALE, DISPLAY_TYPES, commandOptions, listAll, target } from './release-common.mjs';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SIZES = {
  APP_IPHONE_67: [[1260, 2736], [1290, 2796], [1320, 2868]],
  APP_IPAD_PRO_3GEN_129: [[2064, 2752], [2048, 2732]],
};
const EDITABLE_STATES = new Set(['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED']);
const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }

// Deliberately accepts unmodified, non-interlaced RGB PNG screenshots only.
// Never flattens transparency, resizes or changes screenshot pixels.
export function validatePng(bytes, displayType) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length >= 57 && bytes.length <= 20 * 1024 * 1024, 'Expected a PNG of at most 20 MiB');
  assert.ok(bytes.subarray(0, 8).equals(PNG_SIGNATURE), 'Expected a PNG signature');
  assert.ok(SIZES[displayType], 'Unsupported screenshot display type');
  let offset = 8, dimensions, finished = false;
  const imageData = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    assert.ok(offset + length + 12 <= bytes.length, 'Truncated PNG chunk');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    assert.equal(crc32(bytes.subarray(offset + 4, offset + 8 + length)), bytes.readUInt32BE(offset + 8 + length), `Invalid PNG ${type} checksum`);
    assert.ok(dimensions || type === 'IHDR', 'PNG must start with IHDR');
    if (type === 'IHDR') {
      assert.ok(!dimensions && length === 13, 'Invalid PNG header');
      const width = data.readUInt32BE(0), height = data.readUInt32BE(4);
      assert.ok(SIZES[displayType].some(([w, h]) => (width === w && height === h) || (width === h && height === w)), `Unsupported dimensions ${width}×${height} for ${displayType}`);
      assert.equal(data[8], 8, 'Screenshot must use 8-bit RGB');
      assert.equal(data[9], 2, 'Screenshot must be RGB, with no alpha channel');
      assert.equal(data[10], 0, 'Unsupported PNG compression');
      assert.equal(data[11], 0, 'Unsupported PNG filter method');
      assert.equal(data[12], 0, 'Screenshot must be non-interlaced');
      dimensions = { width, height };
    } else if (type === 'tRNS') throw new Error('PNG transparency is not allowed');
    else if (type === 'acTL') throw new Error('Animated PNG is not a screenshot');
    else if (type === 'IDAT') imageData.push(data);
    else if (type === 'IEND') { assert.equal(length, 0); finished = true; offset += 12; break; }
    offset += length + 12;
  }
  assert.ok(finished && offset === bytes.length && imageData.length, 'Incomplete PNG');
  const stride = dimensions.width * 3 + 1;
  const pixels = inflateSync(Buffer.concat(imageData), { maxOutputLength: stride * dimensions.height });
  assert.equal(pixels.length, stride * dimensions.height, 'Invalid PNG pixel payload');
  for (let row = 0; row < dimensions.height; row += 1) assert.ok(pixels[row * stride] <= 4, 'Invalid PNG row filter');
  return dimensions;
}

export async function readManifest(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.appId, APP_ID);
  assert.equal(manifest.bundleId, bundleId);
  assert.equal(manifest.appStoreVersionId, VERSION_ID);
  assert.equal(manifest.version, VERSION);
  assert.equal(manifest.locale, LOCALE);
  assert.match(manifest.buildNumber, /^\d{14}$/, 'Record the exact captured release build number');
  assert.deepEqual(manifest.sets?.map(set => set.displayType).sort(), [...DISPLAY_TYPES].sort(), 'Manifest must contain exactly one iPhone and one iPad set');
  const sets = [];
  for (const set of manifest.sets) {
    assert.ok(Array.isArray(set.files) && set.files.length >= 1 && set.files.length <= 10, 'Each set needs 1–10 files');
    const files = [];
    for (const item of set.files) {
      assert.ok(typeof item.path === 'string' && item.path.length > 0);
      assert.match(item.sha256, /^[a-f0-9]{64}$/i, 'Every screenshot needs an explicit SHA-256');
      const filePath = resolve(dirname(manifestPath), item.path);
      const bytes = await readFile(filePath);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      assert.equal(sha256, item.sha256.toLowerCase(), `Screenshot changed after review: ${basename(filePath)}`);
      files.push({ path: filePath, fileName: basename(filePath), bytes, sha256, checksum: createHash('md5').update(bytes).digest('hex'), ...validatePng(bytes, set.displayType) });
    }
    assert.equal(new Set(files.map(file => file.fileName)).size, files.length, 'Duplicate screenshot filenames');
    assert.equal(new Set(files.map(file => file.sha256)).size, files.length, 'Duplicate screenshot content');
    sets.push({ displayType: set.displayType, files });
  }
  return { manifest, sets };
}

export function existingPrefix(existing, files, receipts, setId) {
  assert.ok(existing.length <= files.length, 'Existing set has extra screenshots; no assets will be deleted');
  return existing.map((asset, index) => {
    const file = files[index];
    const sameChecksum = asset.attributes.sourceFileChecksum?.toLowerCase() === file.checksum;
    const ownReservation = !asset.attributes.sourceFileChecksum
      && !['COMPLETE', 'FAILED', 'UPLOAD_COMPLETE'].includes(asset.attributes.assetDeliveryState?.state)
      && receipts.some(receipt => receipt.id === asset.id && receipt.setId === setId && receipt.sha256 === file.sha256 && receipt.fileName === file.fileName);
    assert.ok(sameChecksum || ownReservation, `Existing screenshot ${asset.id} is different or in another order. This script never overwrites, removes or reorders existing assets; inspect and explicitly resolve the set in App Store Connect first.`);
    assert.notEqual(asset.attributes.assetDeliveryState?.state, 'FAILED', `Existing screenshot ${asset.id} failed processing; inspect it in App Store Connect`);
    return asset;
  });
}

async function uploadChunks(asset, file) {
  const operations = asset.attributes.uploadOperations;
  assert.ok(Array.isArray(operations) && operations.length, 'No resumable upload operations returned');
  let covered = 0;
  for (const operation of [...operations].sort((left, right) => left.offset - right.offset)) {
    const endpoint = new URL(operation.url);
    assert.equal(endpoint.protocol, 'https:');
    assert.ok(!endpoint.username && !endpoint.password && !endpoint.hash, 'Unexpected upload URL');
    assert.equal(operation.method, 'PUT');
    assert.ok(Number.isSafeInteger(operation.offset) && Number.isSafeInteger(operation.length));
    assert.equal(operation.offset, covered, 'Upload chunks must cover the file in order');
    covered += operation.length;
    assert.ok(operation.length > 0 && covered <= file.bytes.length);
    const headers = Object.fromEntries((operation.requestHeaders || []).map(item => [item.name, item.value]));
    // The signed URL and required headers come directly from the authenticated
    // Apple reservation. Never forward our App Store API bearer token.
    const response = await fetch(endpoint, { method: 'PUT', headers, body: file.bytes.subarray(operation.offset, covered), redirect: 'error', signal: AbortSignal.timeout(45000) });
    assert.ok(response.ok, `Screenshot chunk failed: HTTP ${response.status}`);
  }
  assert.equal(covered, file.bytes.length, 'Upload operations did not cover the complete screenshot');
}

export async function main(args = process.argv.slice(2)) {
  const options = commandOptions(args, ['--manifest']);
  if (options.help) { console.log('node app-store/upload-screenshots.mjs --manifest FILE.json [--apply]\nDefault: read-only validation and upload plan. Existing assets are never replaced or reordered.'); return; }
  assert.ok(options.manifest, 'Pass an explicit --manifest FILE.json');
  const { manifest, sets } = await readManifest(resolve(options.manifest));
  const { version, locale } = await target();
  assert.ok(EDITABLE_STATES.has(version.attributes.appVersionState), 'Version is not editable for screenshot upload');
  let journal = { appId: APP_ID, versionId: VERSION_ID, buildNumber: manifest.buildNumber, files: [] };
  try {
    const prior = JSON.parse(await readFile(resolve(privateDirectory, 'screenshots-upload.json'), 'utf8'));
    if (prior.appId === APP_ID && prior.versionId === VERSION_ID && prior.buildNumber === manifest.buildNumber) journal = prior;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const remoteSets = await listAll(`/v1/appStoreVersionLocalizations/${locale.id}/appScreenshotSets?limit=200`);
  const plan = [];
  // Validate every existing set before creating or uploading any asset.
  for (const set of sets) {
    const matching = remoteSets.filter(item => item.attributes.screenshotDisplayType === set.displayType);
    assert.ok(matching.length <= 1, 'Duplicate remote display-type sets');
    const remoteSet = matching[0];
    const assets = remoteSet ? await listAll(`/v1/appScreenshotSets/${remoteSet.id}/appScreenshots?limit=50`) : [];
    existingPrefix(assets, set.files, journal.files, remoteSet?.id);
    plan.push({ ...set, remoteSet, assets });
  }
  const summary = { mode: options.apply ? 'apply' : 'dry-run', appId: APP_ID, versionId: VERSION_ID, buildNumber: manifest.buildNumber, localeId: locale.id, sets: plan.map(set => ({ displayType: set.displayType, existing: set.assets.length, files: set.files.map((file, index) => ({ fileName: file.fileName, width: file.width, height: file.height, sha256: file.sha256, action: set.assets[index] ? 'reuse-or-resume' : 'upload' })) })) };
  if (!options.apply) { console.log(JSON.stringify(summary, null, 2)); return summary; }
  for (const set of plan) {
    let remoteSet = set.remoteSet;
    if (!remoteSet) remoteSet = (await api('/v1/appScreenshotSets', 'POST', { data: { type: 'appScreenshotSets', attributes: { screenshotDisplayType: set.displayType }, relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: locale.id } } } } })).data;
    for (let index = 0; index < set.files.length; index += 1) {
      const file = set.files[index];
      let asset = set.assets[index];
      if (!asset) {
        asset = (await api('/v1/appScreenshots', 'POST', { data: { type: 'appScreenshots', attributes: { fileName: file.fileName, fileSize: file.bytes.length }, relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: remoteSet.id } } } } })).data;
        journal.files.push({ id: asset.id, setId: remoteSet.id, displayType: set.displayType, fileName: file.fileName, sha256: file.sha256, checksum: file.checksum, width: file.width, height: file.height });
        await save('screenshots-upload.json', journal);
      }
      const checksumMatches = asset.attributes.sourceFileChecksum?.toLowerCase() === file.checksum;
      if (!checksumMatches) {
        // Existing reservations are resumed only when our private receipt binds
        // their Apple ID to this exact SHA-256. Never guess from a filename.
        assert.ok(journal.files.some(receipt => receipt.id === asset.id && receipt.sha256 === file.sha256), `Cannot resume unowned screenshot reservation: ${asset.id}`);
        asset = (await api(`/v1/appScreenshots/${asset.id}`)).data;
        await uploadChunks(asset, file);
        asset = (await api(`/v1/appScreenshots/${asset.id}`, 'PATCH', { data: { type: 'appScreenshots', id: asset.id, attributes: { uploaded: true, sourceFileChecksum: file.checksum } } })).data;
      }
      console.log(JSON.stringify({ fileName: file.fileName, id: asset.id, state: asset.attributes.assetDeliveryState?.state }));
    }
    set.remoteSet = remoteSet;
  }
  const verified = [];
  for (const set of plan) {
    const assets = await listAll(`/v1/appScreenshotSets/${set.remoteSet.id}/appScreenshots?limit=50`);
    assert.equal(assets.length, set.files.length);
    existingPrefix(assets, set.files, journal.files, set.remoteSet.id);
    verified.push({ displayType: set.displayType, setId: set.remoteSet.id, files: assets.map((asset, index) => ({ id: asset.id, sha256: set.files[index].sha256, checksum: asset.attributes.sourceFileChecksum, state: asset.attributes.assetDeliveryState?.state })) });
  }
  const result = { ...summary, checkedAt: new Date().toISOString(), verified, allProcessed: verified.every(set => set.files.every(file => file.state === 'COMPLETE')) };
  await save('screenshots-verified.json', result);
  console.log(JSON.stringify({ allProcessed: result.allProcessed, note: result.allProcessed ? 'All screenshots ready' : 'Apple is still processing screenshots; submission will wait for COMPLETE' }));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
