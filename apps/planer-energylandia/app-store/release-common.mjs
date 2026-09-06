import assert from 'node:assert/strict';
import { api, bundleId, findApp } from './asc.mjs';

export const APP_ID = '6808553115';
export const VERSION_ID = '2488c837-248f-4e10-93c7-ac250b04c5a7';
export const VERSION = '1.0';
export const LOCALE = 'pl';
export const DISPLAY_TYPES = ['APP_IPHONE_67', 'APP_IPAD_PRO_3GEN_129'];

export function commandOptions(args, valueFlags = []) {
  const options = { apply: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--apply') { assert.ok(!options.dryRun, 'Do not combine --apply and --dry-run'); options.apply = true; }
    else if (arg === '--dry-run') { assert.ok(!options.apply, 'Do not combine --apply and --dry-run'); options.dryRun = true; }
    else if (arg === '--help') options.help = true;
    else if (valueFlags.includes(arg)) {
      assert.ok(args[index + 1] && !args[index + 1].startsWith('--'), `Missing value for ${arg}`);
      assert.ok(options[arg.slice(2)] === undefined, `Duplicate flag: ${arg}`);
      options[arg.slice(2)] = args[++index];
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export async function listAll(resource, request = api) {
  const records = [];
  while (resource) {
    const response = await request(resource);
    records.push(...response.data);
    if (!response.links?.next) break;
    const next = new URL(response.links.next);
    assert.equal(next.origin, 'https://api.appstoreconnect.apple.com');
    resource = `${next.pathname}${next.search}`;
  }
  return records;
}

export async function optional(resource, request = api) {
  try { return await request(resource); }
  catch (error) { if (/: 404 /.test(error.message)) return null; throw error; }
}

export function assertTarget(app, version) {
  assert.equal(app.id, APP_ID, 'Unexpected App Store app');
  assert.equal(app.attributes.bundleId, bundleId, 'Unexpected bundle identifier');
  assert.equal(version.id, VERSION_ID, 'Unexpected App Store version');
  assert.equal(version.relationships?.app?.data?.id, APP_ID, 'Version belongs to another app');
  assert.equal(version.attributes.platform, 'IOS');
  assert.equal(version.attributes.versionString, VERSION);
}

export async function target() {
  const discovered = await findApp();
  const app = (await api(`/v1/apps/${discovered.id}`)).data;
  const response = await api(`/v1/appStoreVersions/${VERSION_ID}?include=app,build,appStoreVersionLocalizations`);
  assertTarget(app, response.data);
  const locale = response.included?.find(item => item.type === 'appStoreVersionLocalizations' && item.attributes.locale === LOCALE);
  assert.ok(locale, 'Polish version localization is missing');
  return { app, version: response.data, locale, response };
}
