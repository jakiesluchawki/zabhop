import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleId } from './asc.mjs';
import { APP_ID, VERSION_ID, commandOptions, assertTarget } from './release-common.mjs';
import { validatePng, readManifest, existingPrefix } from './upload-screenshots.mjs';
import { assertBuild, screenshotBlockers, selectReviewDraft } from './submit-review.mjs';

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data = Buffer.alloc(0)) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length); bytes.write(type, 4, 4, 'ascii'); data.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, data.length + 8)), data.length + 8);
  return bytes;
}
function png({ width = 1260, height = 2736, colorType = 2, extra = [], pixelLength } = {}) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = colorType;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), ...extra, chunk('IDAT', deflateSync(Buffer.alloc(pixelLength ?? (width * 3 + 1) * height))), chunk('IEND')]);
}
const phone = png();
const ipad = png({ width: 2732, height: 2048 });

test('release tools default to dry-run and reject conflicting or unknown flags', () => {
  assert.equal(commandOptions([]).apply, false);
  assert.equal(commandOptions(['--apply']).apply, true);
  assert.throws(() => commandOptions(['--apply', '--dry-run']));
  assert.throws(() => commandOptions(['--replace']));
  assert.throws(() => commandOptions(['--manifest'], ['--manifest']));
});

test('app/version guard rejects another app, bundle or marketing version', () => {
  const app = { id: APP_ID, attributes: { bundleId } };
  const version = { id: VERSION_ID, attributes: { platform: 'IOS', versionString: '1.0' }, relationships: { app: { data: { id: APP_ID } } } };
  assert.doesNotThrow(() => assertTarget(app, version));
  assert.throws(() => assertTarget({ ...app, id: '6789961777' }, version));
  assert.throws(() => assertTarget({ ...app, attributes: { bundleId: 'pl.mieszkomahboob.zabhop' } }, version));
  assert.throws(() => assertTarget(app, { ...version, attributes: { ...version.attributes, versionString: '2.0' } }));
});

test('valid RGB iPhone portrait and iPad landscape PNG payloads pass', () => {
  assert.deepEqual(validatePng(phone, 'APP_IPHONE_67'), { width: 1260, height: 2736 });
  assert.deepEqual(validatePng(ipad, 'APP_IPAD_PRO_3GEN_129'), { width: 2732, height: 2048 });
});
test('alpha channels and transparent RGB images fail before upload', () => {
  assert.throws(() => validatePng(png({ colorType: 6 }), 'APP_IPHONE_67'), /alpha/);
  assert.throws(() => validatePng(png({ extra: [chunk('tRNS', Buffer.alloc(6))] }), 'APP_IPHONE_67'), /transparency/);
});
test('invalid dimensions and animations fail', () => {
  assert.throws(() => validatePng(png({ width: 100, height: 100 }), 'APP_IPHONE_67'), /dimensions/);
  assert.throws(() => validatePng(png({ extra: [chunk('acTL', Buffer.alloc(8))] }), 'APP_IPHONE_67'), /Animated/);
});
test('corrupt chunks, truncated PNGs and malformed pixels fail', () => {
  const corrupt = Buffer.from(phone); corrupt[29] ^= 1;
  assert.throws(() => validatePng(corrupt, 'APP_IPHONE_67'), /checksum/);
  assert.throws(() => validatePng(phone.subarray(0, phone.length - 3), 'APP_IPHONE_67'));
  assert.throws(() => validatePng(png({ pixelLength: 20 }), 'APP_IPHONE_67'), /payload/);
});

test('manifest ties both device sets to exact SHA-256 and intended release', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pogodapark-release-manifest-'));
  try {
    const manifest = { schemaVersion: 1, appId: APP_ID, bundleId, appStoreVersionId: VERSION_ID, version: '1.0', buildNumber: '20260904120000', locale: 'pl', sets: [
      { displayType: 'APP_IPHONE_67', files: [{ path: 'phone.png', sha256: createHash('sha256').update(phone).digest('hex') }] },
      { displayType: 'APP_IPAD_PRO_3GEN_129', files: [{ path: 'ipad.png', sha256: createHash('sha256').update(ipad).digest('hex') }] },
    ] };
    await writeFile(join(directory, 'phone.png'), phone); await writeFile(join(directory, 'ipad.png'), ipad);
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    assert.equal((await readManifest(join(directory, 'manifest.json'))).sets.length, 2);
    manifest.sets[0].files[0].sha256 = '0'.repeat(64);
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    await assert.rejects(readManifest(join(directory, 'manifest.json')), /changed after review/);
    manifest.bundleId = 'pl.mieszkomahboob.zabhop';
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    await assert.rejects(readManifest(join(directory, 'manifest.json')));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

const file = { fileName: 'phone.png', sha256: 'a'.repeat(64), checksum: 'b'.repeat(32) };
const asset = (state, checksum = file.checksum) => ({ id: 'image-1', attributes: { sourceFileChecksum: checksum, assetDeliveryState: { state } } });
test('existing screenshot checksum permits reuse in the same position', () => {
  assert.equal(existingPrefix([asset('COMPLETE')], [file], [], 'set-1').length, 1);
});
test('only own unfinished reservation permits resuming without a checksum', () => {
  const pending = asset('AWAITING_UPLOAD', null);
  assert.throws(() => existingPrefix([pending], [file], [], 'set-1'), /different/);
  const receipt = { id: 'image-1', setId: 'set-1', sha256: file.sha256, fileName: file.fileName };
  assert.equal(existingPrefix([pending], [file], [receipt], 'set-1').length, 1);
  assert.throws(() => existingPrefix([asset('COMPLETE', 'c'.repeat(32))], [file], [receipt], 'set-1'), /different/);
});
test('existing different, failed or extra screenshots cannot be overwritten', () => {
  assert.throws(() => existingPrefix([asset('COMPLETE', 'x')], [file], [], 'set-1'), /different/);
  assert.throws(() => existingPrefix([asset('FAILED')], [file], [], 'set-1'), /failed processing/);
  assert.throws(() => existingPrefix([asset('COMPLETE'), asset('COMPLETE')], [file], [], 'set-1'), /extra/);
});

const buildNumber = '20260904120000';
function buildFixture() {
  return { build: { id: 'build-1', attributes: { version: buildNumber, processingState: 'VALID', expired: false, buildAudienceType: 'APP_STORE_ELIGIBLE', usesNonExemptEncryption: false }, relationships: { app: { data: { id: APP_ID } }, preReleaseVersion: { data: { id: 'pre-1' } } } }, included: [{ id: APP_ID, type: 'apps', attributes: { bundleId } }, { id: 'pre-1', type: 'preReleaseVersions', attributes: { version: '1.0', platform: 'IOS' } }] };
}
test('submission accepts only exact valid eligible build with resolved encryption', () => {
  const { build, included } = buildFixture();
  assert.doesNotThrow(() => assertBuild(build, included, buildNumber, 'build-1'));
  assert.throws(() => assertBuild(build, included, buildNumber, 'build-2'));
  for (const [key, value] of Object.entries({ processingState: 'PROCESSING', expired: true, buildAudienceType: 'INTERNAL_ONLY', usesNonExemptEncryption: null })) assert.throws(() => assertBuild({ ...build, attributes: { ...build.attributes, [key]: value } }, included, buildNumber));
});
test('submission refuses mismatched app, bundle, build number and prerelease version', () => {
  const { build, included } = buildFixture();
  assert.throws(() => assertBuild(build, included, '20260904120001'));
  assert.throws(() => assertBuild(build, [included[1], { ...included[0], attributes: { bundleId: 'other' } }], buildNumber));
  assert.throws(() => assertBuild(build, [included[0], { ...included[1], attributes: { version: '2.0', platform: 'IOS' } }], buildNumber));
});
test('both iPhone and iPad assets must be complete before submission', () => {
  const sets = ['APP_IPHONE_67', 'APP_IPAD_PRO_3GEN_129'].map(type => ({ type, images: [asset('COMPLETE')] }));
  assert.deepEqual(screenshotBlockers(sets), []);
  assert.equal(screenshotBlockers(sets.slice(0, 1)).length, 1);
  sets[1].images = [asset('UPLOAD_COMPLETE')];
  assert.equal(screenshotBlockers(sets).length, 1);
});
test('review draft reuse is limited to this version and an empty or single-item draft', () => {
  const draft = { id: 'draft-1', attributes: { state: 'READY_FOR_REVIEW', platform: 'IOS' }, items: [] };
  assert.equal(selectReviewDraft([draft]).id, draft.id);
  assert.throws(() => selectReviewDraft([{ ...draft, items: [{ relationships: { appStoreVersion: { data: { id: 'another-version' } } } }] }]));
  assert.throws(() => selectReviewDraft([{ ...draft, attributes: { state: 'IN_REVIEW', platform: 'IOS' } }]));
  assert.throws(() => selectReviewDraft([draft, { ...draft, id: 'draft-2' }]));
});
