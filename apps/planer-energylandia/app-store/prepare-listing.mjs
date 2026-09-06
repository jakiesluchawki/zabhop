import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { api, bundleId, findApp, save } from './asc.mjs';

const EXPECTED_APP_ID = '6808553115';
const VERSION_ID = '2488c837-248f-4e10-93c7-ac250b04c5a7';
const CONTACT_SOURCE_VERSION_ID = 'fa2a071a-35bf-4f43-ad98-10334556b2a7';
const CONTACT_SOURCE_APP_ID = '6789961777';
const copy = JSON.parse(await readFile(new URL('./listing-pl.json', import.meta.url), 'utf8'));
const changes = [];

for (const [field, limit] of Object.entries({ name: 30, subtitle: 30, promotionalText: 170, keywords: 100, description: 4000, reviewNotes: 4000 })) {
  assert.ok(typeof copy[field] === 'string' && copy[field].length > 0 && [...copy[field]].length <= limit, `Invalid listing field: ${field}`);
}

async function optional(resource) {
  try { return await api(resource); }
  catch (error) {
    if (/: 404 /.test(error.message)) return null;
    throw error;
  }
}

async function all(resource) {
  const records = [];
  while (resource) {
    const response = await api(resource);
    records.push(...response.data);
    if (!response.links?.next) break;
    const next = new URL(response.links.next);
    assert.equal(next.origin, 'https://api.appstoreconnect.apple.com');
    resource = `${next.pathname}${next.search}`;
  }
  return records;
}

// Always discover the exact new app first. No mutations in this script target
// the existing ŻabHop record; its review contact is read privately only.
const app = await findApp();
assert.equal(app.id, EXPECTED_APP_ID);
assert.equal(app.attributes.bundleId, 'pl.mieszkomahboob.pogodapark');
assert.equal(app.attributes.bundleId, bundleId);
assert.equal(app.attributes.primaryLocale, 'pl');
const versionResponse = await api(`/v1/appStoreVersions/${VERSION_ID}?include=app,appStoreVersionLocalizations,appStoreReviewDetail`);
let version = versionResponse.data;
assert.equal(version.relationships.app.data.id, app.id);
assert.equal(version.attributes.versionString, '1.0');
assert.equal(version.attributes.platform, 'IOS');
assert.equal(version.attributes.appVersionState, 'PREPARE_FOR_SUBMISSION', 'Refuse to edit a version that has left preparation');
const infoResponse = await api(`/v1/apps/${app.id}/appInfos?include=appInfoLocalizations,primaryCategory,secondaryCategory`);
let info = infoResponse.data.find(item => item.attributes.appStoreState === 'PREPARE_FOR_SUBMISSION');
assert.ok(info, 'Editable app information not found');
const editableIds = new Map([
  ['appInfos', new Set([info.id])],
  ['appStoreVersions', new Set([version.id])],
  ['ageRatingDeclarations', new Set()],
  ['appInfoLocalizations', new Set()],
  ['appStoreVersionLocalizations', new Set()],
  ['appStoreReviewDetails', new Set()],
  ['appAvailabilities', new Set()],
  ['territoryAvailabilities', new Set()],
]);

async function write(label, resource, method, body) {
  const [, , type, id] = resource.split('/');
  assert.ok(!body.data.attributes || !Object.hasOwn(body.data.attributes, 'contentRightsDeclaration'), 'Content rights are handled separately');
  if (method === 'PATCH') assert.ok(editableIds.get(type)?.has(id), `Unverified mutation target: ${resource}`);
  else {
    assert.equal(method, 'POST');
    assert.ok(['appInfoLocalizations', 'appStoreVersionLocalizations', 'appStoreReviewDetails', 'appPriceSchedules', 'appAvailabilities'].includes(type));
    const parent = body.data.relationships;
    if (parent.app) assert.equal(parent.app.data.id, app.id);
    if (parent.appInfo) assert.equal(parent.appInfo.data.id, info.id);
    if (parent.appStoreVersion) assert.equal(parent.appStoreVersion.data.id, version.id);
  }
  const response = await api(resource, method, body);
  changes.push({ label, method, resource, response });
  await save('listing-preparation.json', { checkedAt: new Date().toISOString(), appId: app.id, bundleId, changes });
  console.log(`${label}: saved`);
  return response?.data;
}

async function patchAttributes(label, record, attributes) {
  editableIds.get(record.type)?.add(record.id);
  const changed = Object.fromEntries(Object.entries(attributes).filter(([key, value]) => record.attributes[key] !== value));
  if (!Object.keys(changed).length) return record;
  return write(label, `/v1/${record.type}/${record.id}`, 'PATCH', { data: { type: record.type, id: record.id, attributes: changed } });
}

async function locale(label, type, current, attributes, parentType, parentId) {
  if (current) return patchAttributes(label, current, attributes);
  const relationship = parentType === 'appInfos' ? 'appInfo' : 'appStoreVersion';
  return write(label, `/v1/${type}`, 'POST', { data: { type, attributes: { locale: copy.locale, ...attributes }, relationships: { [relationship]: { data: { type: parentType, id: parentId } } } } });
}

const infoLocale = await locale('Polish app information', 'appInfoLocalizations', infoResponse.included?.find(item => item.type === 'appInfoLocalizations' && item.attributes.locale === copy.locale), {
  name: copy.name, subtitle: copy.subtitle, privacyPolicyUrl: copy.privacyPolicyUrl,
}, 'appInfos', info.id);
const versionLocale = await locale('Polish store description', 'appStoreVersionLocalizations', versionResponse.included?.find(item => item.type === 'appStoreVersionLocalizations' && item.attributes.locale === copy.locale), {
  description: copy.description, keywords: copy.keywords, promotionalText: copy.promotionalText, supportUrl: copy.supportUrl, marketingUrl: copy.marketingUrl,
}, 'appStoreVersions', version.id);

const categories = { primaryCategory: copy.primaryCategory, secondaryCategory: copy.secondaryCategory };
if (Object.entries(categories).some(([key, value]) => info.relationships[key]?.data?.id !== value)) {
  info = await write('Travel and Weather categories', `/v1/appInfos/${info.id}`, 'PATCH', { data: { type: 'appInfos', id: info.id, relationships: Object.fromEntries(Object.entries(categories).map(([key, id]) => [key, { data: { type: 'appCategories', id } }])) } });
}

const rating = (await api(`/v1/appInfos/${info.id}/ageRatingDeclaration`)).data;
// This is a planning utility: brief attraction suitability descriptions are
// documentary guidance, not horror/violence gameplay or mature entertainment.
await patchAttributes('Age-rating questionnaire', rating, {
  advertising: false, alcoholTobaccoOrDrugUseOrReferences: 'NONE', contests: 'NONE', gambling: false, gamblingSimulated: 'NONE', gunsOrOtherWeapons: 'NONE',
  healthOrWellnessTopics: false, lootBox: false, medicalOrTreatmentInformation: 'NONE', messagingAndChat: false, parentalControls: false, profanityOrCrudeHumor: 'NONE', ageAssurance: false,
  sexualContentGraphicAndNudity: 'NONE', sexualContentOrNudity: 'NONE', socialMedia: false, socialMediaAgeRestricted: false, horrorOrFearThemes: 'NONE', matureOrSuggestiveThemes: 'NONE',
  unrestrictedWebAccess: false, userGeneratedContent: false, violenceCartoonOrFantasy: 'NONE', violenceRealisticProlongedGraphicOrSadistic: 'NONE', violenceRealistic: 'NONE', ageRatingOverrideV2: 'NONE', koreaAgeRatingOverride: 'NONE',
});
version = await patchAttributes('Release details', version, { copyright: copy.copyright, releaseType: 'AFTER_APPROVAL', usesIdfa: false });

const sourceVersion = (await api(`/v1/appStoreVersions/${CONTACT_SOURCE_VERSION_ID}?include=app`)).data;
assert.equal(sourceVersion.relationships.app.data.id, CONTACT_SOURCE_APP_ID);
const sourceApp = (await api(`/v1/apps/${CONTACT_SOURCE_APP_ID}?fields[apps]=bundleId`)).data;
assert.equal(sourceApp.attributes.bundleId, 'pl.mieszkomahboob.zabhop');
const sourceContact = (await api(`/v1/appStoreVersions/${CONTACT_SOURCE_VERSION_ID}/appStoreReviewDetail`)).data.attributes;
const contactKeys = ['contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail'];
assert.ok(contactKeys.every(key => typeof sourceContact[key] === 'string' && sourceContact[key].trim()));
const reviewAttributes = { ...Object.fromEntries(contactKeys.map(key => [key, sourceContact[key]])), demoAccountRequired: false, notes: copy.reviewNotes };
let review = (await optional(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`))?.data;
review = review
  ? await patchAttributes('Private review contact and instructions', review, reviewAttributes)
  : await write('Private review contact and instructions', '/v1/appStoreReviewDetails', 'POST', { data: { type: 'appStoreReviewDetails', attributes: reviewAttributes, relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } } } });

const prices = await optional(`/v1/appPriceSchedules/${app.id}/manualPrices?include=appPricePoint,territory&limit=200`);
const polishPrices = prices?.data?.filter(item => item.relationships.territory?.data?.id === 'POL') ?? [];
const freePriceAlreadySet = polishPrices.some(item => !item.attributes.endDate && prices.included?.some(point => point.type === 'appPricePoints' && point.id === item.relationships.appPricePoint.data.id && Number(point.attributes.customerPrice) === 0));
if (!freePriceAlreadySet) {
  const points = await all(`/v1/apps/${app.id}/appPricePoints?filter[territory]=POL&limit=200`);
  const freePoint = points.find(item => Number(item.attributes.customerPrice) === 0);
  assert.ok(freePoint, 'Polish free price point missing');
  await write('Free price in Poland', '/v1/appPriceSchedules', 'POST', {
    data: { type: 'appPriceSchedules', relationships: { app: { data: { type: 'apps', id: app.id } }, baseTerritory: { data: { type: 'territories', id: 'POL' } }, manualPrices: { data: [{ type: 'appPrices', id: '${free}' }] } } },
    included: [{ type: 'appPrices', id: '${free}', attributes: { startDate: null, endDate: null }, relationships: { appPricePoint: { data: { type: 'appPricePoints', id: freePoint.id } } } }],
  });
}

let availability = (await optional(`/v1/apps/${app.id}/appAvailabilityV2`))?.data;
if (!availability) {
  const territories = await all('/v1/territories?limit=200');
  assert.ok(territories.some(territory => territory.id === 'POL'));
  const included = territories.map(territory => ({ type: 'territoryAvailabilities', id: `\${${territory.id}}`, attributes: { available: territory.id === 'POL', preOrderEnabled: false }, relationships: { territory: { data: { type: 'territories', id: territory.id } } } }));
  availability = await write('Polish storefront availability', '/v2/appAvailabilities', 'POST', { data: { type: 'appAvailabilities', attributes: { availableInNewTerritories: false }, relationships: { app: { data: { type: 'apps', id: app.id } }, territoryAvailabilities: { data: included.map(({ type, id }) => ({ type, id })) } } }, included });
} else {
  editableIds.get('appAvailabilities').add(availability.id);
  if (availability.attributes.availableInNewTerritories !== false) availability = await write('Keep existing storefront scope', `/v2/appAvailabilities/${availability.id}`, 'PATCH', { data: { type: 'appAvailabilities', id: availability.id, attributes: { availableInNewTerritories: false } } });
  const territories = await all(`/v2/appAvailabilities/${availability.id}/territoryAvailabilities?limit=200&include=territory`);
  for (const territory of territories) {
    const available = territory.relationships.territory.data.id === 'POL';
    await patchAttributes('Verify Polish storefront scope', territory, { available });
  }
}

const verified = {
  checkedAt: new Date().toISOString(), appId: app.id, bundleId,
  info: await api(`/v1/appInfos/${info.id}?include=primaryCategory,secondaryCategory,appInfoLocalizations`),
  version: await api(`/v1/appStoreVersions/${version.id}?include=appStoreVersionLocalizations,appStoreReviewDetail`),
  ageRating: await api(`/v1/appInfos/${info.id}/ageRatingDeclaration`),
  prices: await api(`/v1/appPriceSchedules/${app.id}/manualPrices?include=appPricePoint,territory&limit=200`),
  availability: await all(`/v2/appAvailabilities/${availability.id}/territoryAvailabilities?include=territory&limit=200`),
  infoLocaleId: infoLocale.id, versionLocaleId: versionLocale.id,
};
await save('listing-verified.json', verified);
const localeAfter = verified.version.included.find(item => item.type === 'appStoreVersionLocalizations' && item.id === versionLocale.id);
assert.equal(localeAfter.attributes.description, copy.description);
assert.equal(verified.info.data.relationships.primaryCategory.data.id, 'TRAVEL');
assert.equal(verified.info.data.relationships.secondaryCategory.data.id, 'WEATHER');
assert.deepEqual(verified.availability.filter(item => item.attributes.available).map(item => item.relationships.territory.data.id), ['POL']);
assert.ok(verified.prices.included.some(item => item.type === 'appPricePoints' && Number(item.attributes.customerPrice) === 0));
console.log(JSON.stringify({ appId: app.id, bundleId, infoLocaleId: infoLocale.id, versionLocaleId: versionLocale.id, ageRating: verified.info.data.attributes.appStoreAgeRating, free: true, territories: ['POL'], changes: changes.length, privateReviewContactComplete: true, contentRightsUnchanged: true }, null, 2));
