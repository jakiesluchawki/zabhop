import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { api, bundleId, save } from './asc.mjs';
import { APP_ID, VERSION_ID, VERSION, DISPLAY_TYPES, commandOptions, listAll, optional, target } from './release-common.mjs';

const SENT_STATES = new Set(['WAITING_FOR_REVIEW', 'IN_REVIEW', 'PENDING_DEVELOPER_RELEASE', 'PENDING_APPLE_RELEASE', 'READY_FOR_DISTRIBUTION', 'READY_FOR_SALE']);
const EDITABLE_STATES = new Set(['PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW']);

export function assertBuild(build, included, number, expectedId) {
  assert.match(number, /^\d{14}$/, 'Pass the exact verified release build number');
  assert.equal(build.attributes.version, number);
  if (expectedId) assert.equal(build.id, expectedId, 'Build ID and number disagree');
  assert.equal(build.relationships.app.data.id, APP_ID, 'Build belongs to another app');
  assert.equal(build.attributes.processingState, 'VALID', 'Build processing is not VALID');
  assert.equal(build.attributes.expired, false, 'Build has expired');
  assert.equal(build.attributes.buildAudienceType, 'APP_STORE_ELIGIBLE', 'Build is not App Store eligible');
  assert.equal(build.attributes.usesNonExemptEncryption, false, 'Encryption declaration is not resolved');
  const preRelease = included.find(item => item.type === 'preReleaseVersions' && item.id === build.relationships.preReleaseVersion.data.id);
  assert.equal(preRelease?.attributes.version, VERSION, 'Wrong build marketing version');
  assert.equal(preRelease?.attributes.platform, 'IOS', 'Wrong build platform');
  const app = included.find(item => item.type === 'apps' && item.id === APP_ID);
  assert.equal(app?.attributes.bundleId, bundleId, 'Build bundle identifier does not match');
}

export function screenshotBlockers(sets) {
  const blockers = [];
  for (const type of DISPLAY_TYPES) {
    const matching = sets.filter(set => set.type === type);
    if (matching.length !== 1) { blockers.push(`Exactly one ${type} screenshot set is required`); continue; }
    const images = matching[0].images;
    if (images.length < 1 || images.length > 10) blockers.push(`${type} requires 1–10 screenshots`);
    if (images.some(image => image.attributes.assetDeliveryState?.state !== 'COMPLETE')) blockers.push(`${type} screenshots have not all reached COMPLETE`);
  }
  return blockers;
}

export function selectReviewDraft(submissions) {
  const active = submissions.filter(item => ['READY_FOR_REVIEW', 'WAITING_FOR_REVIEW', 'IN_REVIEW', 'UNRESOLVED_ISSUES'].includes(item.attributes.state) && item.attributes.platform === 'IOS');
  for (const submission of active) {
    assert.ok(submission.items.every(item => item.relationships?.appStoreVersion?.data?.id === VERSION_ID), 'Another version or content item is present in the active iOS submission');
    assert.equal(submission.attributes.state, 'READY_FOR_REVIEW', 'An iOS review is already active or has unresolved issues; inspect it without creating another submission');
    assert.ok(submission.items.length <= 1, 'Unexpected duplicate review items');
    assert.ok(submission.items.every(item => !['REJECTED', 'REMOVED'].includes(item.attributes.state)), 'Existing review item requires a separate correction workflow');
  }
  assert.ok(active.length <= 1, 'Multiple editable iOS review drafts; inspect manually');
  return active[0] ?? null;
}

export async function main(args = process.argv.slice(2)) {
  const options = commandOptions(args, ['--build', '--build-id']);
  if (options.help) { console.log('node app-store/submit-review.mjs --build YYYYMMDDHHMMSS [--build-id UUID] [--apply]\nDefault: read-only readiness report. --apply attaches the exact build and submits this version to Apple.'); return; }
  assert.match(options.build || '', /^\d{14}$/, 'Pass --build with the exact verified 14-digit build number');
  const { app, version, locale } = await target();
  const candidates = await listAll(`/v1/builds?filter[app]=${APP_ID}&filter[version]=${options.build}&limit=200`);
  assert.equal(candidates.length, 1, 'Expected exactly one build matching this app and build number');
  const buildResponse = await api(`/v1/builds/${candidates[0].id}?include=app,preReleaseVersion`);
  const build = buildResponse.data;
  assertBuild(build, buildResponse.included || [], options.build, options['build-id']);
  const attachedBuildId = version.relationships.build?.data?.id;
  if (SENT_STATES.has(version.attributes.appVersionState)) {
    assert.equal(attachedBuildId, build.id, 'Another build has already been submitted');
    const result = { mode: options.apply ? 'apply' : 'dry-run', appId: APP_ID, versionId: VERSION_ID, buildId: build.id, buildNumber: options.build, state: version.attributes.appVersionState, alreadySubmitted: true, changes: 0 };
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  assert.ok(EDITABLE_STATES.has(version.attributes.appVersionState), 'Version needs a separate correction workflow before submission');
  const blockers = [];
  if (app.attributes.contentRightsDeclaration !== 'USES_THIRD_PARTY_CONTENT') blockers.push('Content-rights declaration has not been confirmed in App Store Connect');
  if (!locale.attributes.description || !locale.attributes.supportUrl || !locale.attributes.keywords) blockers.push('Polish store metadata is incomplete');
  if (!version.attributes.copyright || version.attributes.usesIdfa !== false) blockers.push('Copyright or IDFA declaration is missing');
  const infoResponse = await api(`/v1/apps/${APP_ID}/appInfos?include=appInfoLocalizations,primaryCategory`);
  const info = infoResponse.data.find(item => item.attributes.appStoreState === 'PREPARE_FOR_SUBMISSION') || infoResponse.data[0];
  if (!info?.attributes.appStoreAgeRating) blockers.push('Age rating is incomplete');
  if (!infoResponse.included?.some(item => item.type === 'appInfoLocalizations' && item.attributes.locale === 'pl' && item.attributes.privacyPolicyUrl)) blockers.push('Privacy policy URL is missing');
  const review = (await optional(`/v1/appStoreVersions/${VERSION_ID}/appStoreReviewDetail`))?.data;
  if (!review || !['contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail', 'notes'].every(key => Boolean(review.attributes[key])) || review.attributes.demoAccountRequired !== false) blockers.push('Review contact or no-login instructions are incomplete');
  const screenshotSets = await listAll(`/v1/appStoreVersionLocalizations/${locale.id}/appScreenshotSets?limit=200`);
  const screenshots = [];
  for (const set of screenshotSets) screenshots.push({ type: set.attributes.screenshotDisplayType, id: set.id, images: await listAll(`/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`) });
  blockers.push(...screenshotBlockers(screenshots));
  const prices = await optional(`/v1/appPriceSchedules/${APP_ID}/manualPrices?include=appPricePoint,territory&limit=200`);
  if (!prices?.data.some(price => price.relationships.territory?.data?.id === 'POL' && !price.attributes.endDate && prices.included?.some(point => point.type === 'appPricePoints' && point.id === price.relationships.appPricePoint.data.id && Number(point.attributes.customerPrice) === 0))) blockers.push('Free Polish price is not configured');
  const availability = (await optional(`/v1/apps/${APP_ID}/appAvailabilityV2`))?.data;
  const territories = availability ? await listAll(`/v2/appAvailabilities/${availability.id}/territoryAvailabilities?include=territory&limit=200`) : [];
  if (!territories.some(item => item.attributes.available && item.relationships.territory.data.id === 'POL')) blockers.push('Polish availability is missing');
  const submissions = await listAll(`/v1/apps/${APP_ID}/reviewSubmissions?limit=200`);
  for (const submission of submissions) {
    if (submission.attributes.platform === 'IOS' && ['READY_FOR_REVIEW', 'WAITING_FOR_REVIEW', 'IN_REVIEW', 'UNRESOLVED_ISSUES'].includes(submission.attributes.state)) submission.items = await listAll(`/v1/reviewSubmissions/${submission.id}/items?limit=200`);
  }
  let draft;
  try { draft = selectReviewDraft(submissions); } catch (error) { blockers.push(error.message); }
  const plan = { mode: options.apply ? 'apply' : 'dry-run', checkedAt: new Date().toISOString(), appId: APP_ID, bundleId, versionId: VERSION_ID, buildId: build.id, buildNumber: options.build, attachedBuildId: attachedBuildId || null, screenshotCounts: screenshots.map(set => ({ type: set.type, count: set.images.length })), blockers, apiChecksPassed: blockers.length === 0, serverValidationPending: true, note: 'App Privacy publication and any other account-level submission requirements are validated by Apple when a review item is added. A dry-run never adds that item and cannot claim submission readiness beyond the checks shown.', plannedActions: ['Attach the exact verified build if needed', draft ? 'Reuse the matching review draft' : 'Create an iOS review draft for this app', 'Add this version if needed and let Apple validate it', 'Submit this draft to Apple review'] };
  if (!options.apply) { console.log(JSON.stringify(plan, null, 2)); return plan; }
  assert.equal(blockers.length, 0, `Submission blocked: ${blockers.join('; ')}`);
  const journal = { ...plan, changes: [] };
  const record = async (label, response) => {
    journal.changes.push({ label, data: response?.data ?? null });
    await save('review-submission.json', journal);
    console.log(JSON.stringify({ label, id: response?.data?.id, state: response?.data?.attributes?.state }));
    return response?.data;
  };
  await save('review-submission.json', journal);
  if (attachedBuildId !== build.id) {
    await record('Attach verified build', await api(`/v1/appStoreVersions/${VERSION_ID}/relationships/build`, 'PATCH', { data: { type: 'builds', id: build.id } }));
    const attached = (await api(`/v1/appStoreVersions/${VERSION_ID}/relationships/build`)).data;
    assert.equal(attached.id, build.id, 'Build attachment could not be verified');
  }
  if (!draft) draft = await record('Create review draft', await api('/v1/reviewSubmissions', 'POST', { data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: APP_ID } } } } }));
  const items = await listAll(`/v1/reviewSubmissions/${draft.id}/items?limit=200`);
  assert.ok(items.every(item => item.relationships?.appStoreVersion?.data?.id === VERSION_ID) && items.length <= 1, 'Review draft changed; refusing submission');
  if (!items.length) await record('Add and validate this version', await api('/v1/reviewSubmissionItems', 'POST', { data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: draft.id } }, appStoreVersion: { data: { type: 'appStoreVersions', id: VERSION_ID } } } } }));
  await record('Submit to Apple review', await api(`/v1/reviewSubmissions/${draft.id}`, 'PATCH', { data: { type: 'reviewSubmissions', id: draft.id, attributes: { submitted: true } } }));
  const finalSubmission = await record('Verify submission state', await api(`/v1/reviewSubmissions/${draft.id}`));
  const finalVersion = (await api(`/v1/appStoreVersions/${VERSION_ID}?include=build`)).data;
  assert.ok(['WAITING_FOR_REVIEW', 'IN_REVIEW'].includes(finalSubmission.attributes.state), 'Apple has not confirmed entry into the review queue');
  assert.equal(finalVersion.relationships.build.data.id, build.id, 'Submitted build differs from the verified build');
  const result = { appId: APP_ID, versionId: VERSION_ID, buildId: build.id, buildNumber: options.build, submissionId: draft.id, state: finalSubmission.attributes.state, checkedAt: new Date().toISOString() };
  journal.result = result;
  await save('review-submission.json', journal);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
