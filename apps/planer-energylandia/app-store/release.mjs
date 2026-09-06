import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, chmod, mkdir, readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configuration, findApp, privateDirectory, save } from './asc.mjs';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = await configuration();
const app = await findApp();
const upload = process.argv.includes('--upload');
const build = process.env.POGODAPARK_BUILD_NUMBER || new Date().toISOString().replace(/\D/g, '').slice(0, 14);
assert.match(build, /^\d{1,18}$/);
assert.ok(config.signingKeychainPath?.endsWith('.keychain-db') && !basename(config.signingKeychainPath).startsWith('login'), 'Use a dedicated distribution keychain');
assert.match(config.certificateFingerprint, /^[A-Fa-f0-9]{40}$/);
await Promise.all([access(config.keyPath), access(config.signingKeychainPath)]);
const releaseDirectory = resolve(privateDirectory, 'releases', build);
console.log(JSON.stringify({ appId: app.id, bundleId: app.attributes.bundleId, build, releaseDirectory, mode: upload ? 'archive-and-upload' : 'preflight' }));
if (!upload) process.exit(0);

await mkdir(releaseDirectory, { recursive: true, mode: 0o700 });
await chmod(releaseDirectory, 0o700);
const helper = resolve(releaseDirectory, 'keychain-status');
const compile = spawnSync('/usr/bin/xcrun', ['clang', '-Wno-deprecated-declarations', '-framework', 'Security', '-framework', 'CoreFoundation', resolve(appDirectory, 'app-store/keychain-status.c'), '-o', helper], { encoding: 'utf8', timeout: 120000 });
assert.equal(compile.status, 0, 'Could not compile read-only keychain status helper');
const status = spawnSync(helper, [config.signingKeychainPath], { encoding: 'utf8', timeout: 15000 });
assert.equal(status.status, 0, 'Could not determine dedicated keychain state');
const wasLocked = status.stdout.trim() === 'locked';
assert.ok(['locked', 'unlocked'].includes(status.stdout.trim()));
let unlockedByThisRun = false;
const startedAt = new Date().toISOString();
try {
  if (wasLocked) {
    const passwordPath = config.signingKeychainPasswordPath || resolve(dirname(config.signingKeychainPath), 'keychain-password');
    const secret = (await readFile(passwordPath, 'utf8')).trim();
    assert.ok(secret, 'Dedicated signing keychain credential missing');
    const unlock = spawnSync('/usr/bin/security', ['unlock-keychain', '-p', secret, config.signingKeychainPath], { stdio: 'pipe', timeout: 15000 });
    assert.equal(unlock.status, 0, 'Could not unlock dedicated signing keychain');
    unlockedByThisRun = true;
  }
  const log = createWriteStream(resolve(releaseDirectory, 'release.log'), { flags: 'a', mode: 0o600 });
  const child = spawn('/bin/sh', ['scripts/release-ios.sh'], {
    cwd: appDirectory, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env,
      POGODAPARK_ASC_KEY_PATH: config.keyPath,
      POGODAPARK_ASC_KEY_ID: config.keyId,
      POGODAPARK_ASC_ISSUER_ID: config.issuerId,
      POGODAPARK_SIGNING_KEYCHAIN_PATH: config.signingKeychainPath,
      POGODAPARK_SIGNING_IDENTITY: config.certificateFingerprint,
      POGODAPARK_PROVISIONING_PROFILE_SPECIFIER: config.profileName,
      POGODAPARK_BUILD_NUMBER: build,
      POGODAPARK_RELEASE_DIR: releaseDirectory,
    },
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  console.log('Release started; detailed output is stored privately in release.log.');
  const code = await new Promise((resolveCode, reject) => { child.once('error', reject); child.once('close', resolveCode); });
  await new Promise(resolveDone => log.end(resolveDone));
  await save('release-last.json', { appId: app.id, bundleId: app.attributes.bundleId, build, startedAt, finishedAt: new Date().toISOString(), releaseDirectory, exitCode: code });
  assert.equal(code, 0, 'Archive/upload failed; inspect the private release.log. No successful upload is implied.');
  console.log('Archive upload completed. Verify Apple processing separately before submission.');
} finally {
  if (unlockedByThisRun) {
    const lock = spawnSync('/usr/bin/security', ['lock-keychain', config.signingKeychainPath], { stdio: 'pipe', timeout: 15000 });
    if (lock.status !== 0) throw new Error('Release finished but the dedicated keychain could not be restored to its original locked state.');
  }
}
