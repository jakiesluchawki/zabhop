import assert from 'node:assert/strict';
import { sign, X509Certificate } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const bundleId = 'pl.mieszkomahboob.pogodapark';
export const appName = 'PogodaPark';
export const teamId = '78N6WG8P57';
export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const privateDirectory = resolve(repositoryRoot, '.local/pogodapark');

export async function configuration() {
  const file = process.env.POGODAPARK_ASC_CONFIG || resolve(privateDirectory, 'app-store-connect.json');
  const value = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(value.teamId, teamId, 'Unexpected Apple Developer team');
  assert.ok(value.keyPath && value.keyId && value.issuerId, 'Missing App Store Connect configuration');
  return value;
}

export async function api(resource, method = 'GET', body) {
  assert.match(resource, /^\/v[12]\//);
  assert.ok(['GET', 'POST', 'PATCH'].includes(method), 'Deletion and credential revocation are not supported');
  const config = await configuration();
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const input = `${encode({ alg: 'ES256', kid: config.keyId, typ: 'JWT' })}.${encode({ iss: config.issuerId, iat: now - 5, exp: now + 600, aud: 'appstoreconnect-v1' })}`;
  const signature = sign('sha256', Buffer.from(input), { key: await readFile(config.keyPath), dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const response = await fetch(`https://api.appstoreconnect.apple.com${resource}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${input}.${signature}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(`${method} ${resource}: ${response.status} ${JSON.stringify(result?.errors?.map(({ code, title, detail }) => ({ code, title, detail })))}`);
  return result;
}

export async function save(name, value) {
  assert.match(name, /^[a-z0-9.-]+\.json$/);
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
  await writeFile(resolve(privateDirectory, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export async function findApp(required = true) {
  const result = await api(`/v1/apps?filter[bundleId]=${bundleId}&fields[apps]=name,bundleId,sku,primaryLocale&limit=10`);
  const app = result.data.find(item => item.attributes.bundleId === bundleId);
  if (required) assert.ok(app, 'Create the PogodaPark app record in the App Store Connect website first');
  return app;
}

export async function registerBundle() {
  let bundle = (await api(`/v1/bundleIds?filter[identifier]=${bundleId}&limit=10`)).data.find(item => item.attributes.identifier === bundleId);
  if (!bundle) bundle = (await api('/v1/bundleIds', 'POST', { data: { type: 'bundleIds', attributes: { identifier: bundleId, name: appName, platform: 'IOS' } } })).data;
  assert.equal(bundle.attributes.identifier, bundleId);
  await save('bundle.json', bundle);
  return bundle;
}

export async function prepareProfile() {
  const config = await configuration();
  const bundle = await registerBundle();
  const localCertificate = new X509Certificate(await readFile(config.signingCertificatePath));
  const normalize = value => String(value).replace(/[^a-f0-9]/gi, '').toUpperCase();
  assert.equal(normalize(localCertificate.fingerprint), normalize(config.certificateFingerprint));
  const certificates = (await api('/v1/certificates?limit=200')).data;
  const certificate = certificates.find(item => {
    if (!['DISTRIBUTION', 'IOS_DISTRIBUTION'].includes(item.attributes.certificateType)) return false;
    if (Date.parse(item.attributes.expirationDate) <= Date.now()) return false;
    return item.attributes.certificateContent
      ? normalize(new X509Certificate(Buffer.from(item.attributes.certificateContent, 'base64')).fingerprint) === normalize(config.certificateFingerprint)
      : normalize(item.attributes.serialNumber) === normalize(localCertificate.serialNumber);
  });
  assert.ok(certificate, 'Existing distribution certificate is unavailable; no certificates were changed');
  const profiles = (await api('/v1/profiles?filter[profileType]=IOS_APP_STORE&limit=200&include=bundleId,certificates')).data;
  let profile = profiles.find(item => item.attributes.profileType === 'IOS_APP_STORE'
    && item.relationships?.bundleId?.data?.id === bundle.id
    && item.attributes.profileState === 'ACTIVE'
    && Date.parse(item.attributes.expirationDate) > Date.now()
    && item.attributes.name === config.profileName
    && item.relationships?.certificates?.data?.some(link => link.id === certificate.id));
  if (!profile) profile = (await api('/v1/profiles', 'POST', { data: { type: 'profiles', attributes: { name: config.profileName, profileType: 'IOS_APP_STORE' }, relationships: { bundleId: { data: { type: 'bundleIds', id: bundle.id } }, certificates: { data: [{ type: 'certificates', id: certificate.id }] } } } })).data;
  if (!profile.attributes.profileContent) profile = (await api(`/v1/profiles/${profile.id}`)).data;
  assert.match(profile.attributes.uuid, /^[a-z0-9-]+$/i);
  const directory = resolve(homedir(), 'Library/Developer/Xcode/UserData/Provisioning Profiles');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const installedPath = resolve(directory, `${profile.attributes.uuid}.mobileprovision`);
  await writeFile(installedPath, Buffer.from(profile.attributes.profileContent, 'base64'), { mode: 0o600 });
  const result = { bundleId, teamId, profileId: profile.id, profileName: profile.attributes.name, profileUUID: profile.attributes.uuid, expirationDate: profile.attributes.expirationDate, installedPath, certificateFingerprint: config.certificateFingerprint };
  await save('signing.json', result);
  return result;
}

export async function status() {
  const app = await findApp(false);
  const result = { checkedAt: new Date().toISOString(), bundleId, app: app || null };
  if (app) {
    result.versions = (await api(`/v1/apps/${app.id}/appStoreVersions?limit=20`)).data;
    result.builds = (await api(`/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=10`)).data.map(({ id, attributes }) => ({ id, ...attributes }));
    result.submissions = (await api(`/v1/apps/${app.id}/reviewSubmissions?limit=20`)).data;
  }
  await save('status.json', result);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const action = { status, bundle: registerBundle, profile: prepareProfile }[process.argv[2] || 'status'];
  assert.ok(action, 'Supported commands: status, bundle, profile');
  console.log(JSON.stringify(await action(), null, 2));
}
