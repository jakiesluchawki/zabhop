#!/usr/bin/env node

import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";

const keyPath = process.env.ZABHOP_ASC_KEY_PATH;
const keyId = process.env.ZABHOP_ASC_KEY_ID;
const issuerId = process.env.ZABHOP_ASC_ISSUER_ID;
const bundleId = process.env.ZABHOP_IOS_BUNDLE_ID || "pl.mieszkomahboob.zabhop";

if (!keyPath || !keyId || !issuerId) {
  throw new Error("App Store Connect API configuration is incomplete.");
}

const now = Math.floor(Date.now() / 1_000);
const base64url = (value) => Buffer.from(value).toString("base64url");
const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
const payload = base64url(JSON.stringify({
  iss: issuerId,
  iat: now,
  exp: now + 600,
  aud: "appstoreconnect-v1"
}));
const signingInput = `${header}.${payload}`;
const signature = sign("sha256", Buffer.from(signingInput), {
  key: createPrivateKey(readFileSync(keyPath)),
  dsaEncoding: "ieee-p1363"
}).toString("base64url");
const token = `${signingInput}.${signature}`;

async function request(method, path, { params = {}, body } = {}) {
  const url = new URL(`https://api.appstoreconnect.apple.com${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

function errors(...results) {
  return results.flatMap((result) => result?.json?.errors || [])
    .map(({ status, code, title, detail }) => ({ status, code, title, detail }));
}

function requireSuccess(result, description) {
  if (result.status >= 200 && result.status < 300) return result;
  throw new Error(`${description}: ${JSON.stringify(errors(result))}`);
}

function item(result) {
  return result?.json?.data
    ? { id: result.json.data.id, ...result.json.data.attributes }
    : null;
}

function items(result) {
  return (result?.json?.data || []).map(({ id, attributes }) => ({ id, ...attributes }));
}

async function findApp() {
  const result = requireSuccess(await request("GET", "/v1/apps", {
    params: {
      "filter[bundleId]": bundleId,
      "fields[apps]": "name,bundleId,sku,primaryLocale",
      limit: "1"
    }
  }), "Unable to find ŻabHop in App Store Connect");
  const app = result.json.data?.[0];
  if (!app) throw new Error(`No App Store Connect application exists for ${bundleId}.`);
  return app;
}

function getBuilds(appId) {
  return request("GET", "/v1/builds", {
    params: {
      "filter[app]": appId,
      "fields[builds]": "version,uploadedDate,expirationDate,expired,minOsVersion,processingState,buildAudienceType,usesNonExemptEncryption",
      sort: "-uploadedDate",
      limit: "50"
    }
  });
}

function getGroups(appId) {
  return request("GET", "/v1/betaGroups", {
    params: {
      "filter[app]": appId,
      "fields[betaGroups]": "name,isInternalGroup,publicLinkEnabled,publicLink,feedbackEnabled",
      limit: "50"
    }
  });
}

function getReviewSubmissions(buildId) {
  return request("GET", "/v1/betaAppReviewSubmissions", {
    params: {
      "filter[build]": buildId,
      "fields[betaAppReviewSubmissions]": "betaReviewState,submittedDate",
      limit: "50"
    }
  });
}

async function inspectBuilds() {
  const app = await findApp();
  const builds = requireSuccess(await getBuilds(app.id), "Unable to read ŻabHop builds");
  console.log(JSON.stringify({
    appRequestStatus: 200,
    app: { id: app.id, ...app.attributes },
    buildRequestStatus: builds.status,
    builds: items(builds),
    apiErrors: errors(builds)
  }, null, 2));
}

async function inspectExternal() {
  const app = await findApp();
  const [groups, builds] = await Promise.all([
    getGroups(app.id),
    getBuilds(app.id)
  ]);
  requireSuccess(groups, "Unable to inspect TestFlight groups");
  requireSuccess(builds, "Unable to inspect TestFlight builds");

  const betaGroups = await Promise.all((groups.json.data || []).map(async (group) => {
    const linkedBuilds = await request("GET", `/v1/betaGroups/${group.id}/builds`, {
      params: {
        "fields[builds]": "version,uploadedDate,processingState,buildAudienceType",
        limit: "200"
      }
    });
    return {
      id: group.id,
      ...group.attributes,
      buildRequestStatus: linkedBuilds.status,
      builds: items(linkedBuilds),
      apiErrors: errors(linkedBuilds)
    };
  }));

  const detailedBuilds = await Promise.all((builds.json.data || []).slice(0, 10).map(async (build) => {
    const [detail, submissions] = await Promise.all([
      request("GET", `/v1/builds/${build.id}/buildBetaDetail`, {
        params: { "fields[buildBetaDetails]": "autoNotifyEnabled,internalBuildState,externalBuildState" }
      }),
      getReviewSubmissions(build.id)
    ]);
    return {
      id: build.id,
      ...build.attributes,
      betaDetail: item(detail),
      reviewSubmissions: items(submissions),
      apiErrors: errors(detail, submissions)
    };
  }));

  console.log(JSON.stringify({
    app: { id: app.id, ...app.attributes },
    betaGroups,
    builds: detailedBuilds,
    apiErrors: errors(groups, builds)
  }, null, 2));
}

async function updateWhatToTest(build) {
  const whatsNew = process.env.ZABHOP_WHATS_NEW?.trim()
    || "Niezależne aktualizacje baz sklepów, dokładniejsza informacja o otwarciu, szacowany czas dojścia i ostrzeżenia przed zamknięciem.";
  const localizations = requireSuccess(await request("GET", `/v1/builds/${build.id}/betaBuildLocalizations`, {
    params: { "fields[betaBuildLocalizations]": "locale,whatsNew", limit: "50" }
  }), "Unable to inspect What to Test localizations");
  const polish = (localizations.json.data || []).find((entry) => entry.attributes?.locale === "pl");

  return requireSuccess(polish
    ? await request("PATCH", `/v1/betaBuildLocalizations/${polish.id}`, {
      body: { data: { type: "betaBuildLocalizations", id: polish.id, attributes: { whatsNew } } }
    })
    : await request("POST", "/v1/betaBuildLocalizations", {
      body: {
        data: {
          type: "betaBuildLocalizations",
          attributes: { locale: "pl", whatsNew },
          relationships: { build: { data: { type: "builds", id: build.id } } }
        }
      }
    }), "Unable to update What to Test");
}

async function submitExternal() {
  const expectedBuildId = process.env.ZABHOP_EXTERNAL_BUILD_ID?.trim();
  const expectedBuildVersion = process.env.ZABHOP_EXTERNAL_BUILD_VERSION?.trim();
  const confirmation = process.env.ZABHOP_EXTERNAL_CONFIRM?.trim();
  if (!expectedBuildId || !expectedBuildVersion) {
    throw new Error("Set both ZABHOP_EXTERNAL_BUILD_ID and ZABHOP_EXTERNAL_BUILD_VERSION.");
  }
  if (confirmation !== `SUBMIT_EXTERNAL_${expectedBuildVersion}`) {
    throw new Error(`Set ZABHOP_EXTERNAL_CONFIRM=SUBMIT_EXTERNAL_${expectedBuildVersion} for this exact build.`);
  }

  const app = await findApp();
  const [groupResult, buildResult] = await Promise.all([getGroups(app.id), getBuilds(app.id)]);
  requireSuccess(groupResult, "Unable to inspect TestFlight groups");
  requireSuccess(buildResult, "Unable to inspect TestFlight builds");

  const group = (groupResult.json.data || []).find((candidate) =>
    !candidate.attributes?.isInternalGroup && candidate.attributes?.name === "Testerzy"
  );
  if (!group?.attributes?.publicLinkEnabled || !group.attributes.publicLink) {
    throw new Error("External TestFlight group Testerzy does not have an enabled public link.");
  }
  const build = (buildResult.json.data || []).find((candidate) => candidate.id === expectedBuildId);
  if (!build || build.attributes?.version !== expectedBuildVersion) {
    throw new Error("The selected build ID/version does not belong to ŻabHop.");
  }
  if (build.attributes.processingState !== "VALID" || build.attributes.expired) {
    throw new Error("The selected build has not finished valid App Store Connect processing.");
  }
  if (build.attributes.buildAudienceType !== "APP_STORE_ELIGIBLE") {
    throw new Error("The selected build is not eligible for external TestFlight distribution.");
  }
  if (build.attributes.usesNonExemptEncryption !== false) {
    throw new Error("The selected build still requires export-compliance resolution.");
  }

  const localization = await updateWhatToTest(build);
  const [linkedBuilds, existingSubmissions] = await Promise.all([
    request("GET", `/v1/betaGroups/${group.id}/builds`, {
      params: { "fields[builds]": "version,processingState", limit: "200" }
    }),
    getReviewSubmissions(build.id)
  ]);
  requireSuccess(linkedBuilds, "Unable to inspect existing Testerzy builds");
  requireSuccess(existingSubmissions, "Unable to inspect existing beta-review submissions");

  let groupBuildStatus = 200;
  if (!(linkedBuilds.json.data || []).some((candidate) => candidate.id === build.id)) {
    const attached = requireSuccess(await request("POST", `/v1/betaGroups/${group.id}/relationships/builds`, {
      body: { data: [{ type: "builds", id: build.id }] }
    }), "Unable to attach the build to Testerzy");
    groupBuildStatus = attached.status;
  }

  const activeSubmission = (existingSubmissions.json.data || []).find((submission) =>
    ["WAITING_FOR_REVIEW", "IN_REVIEW", "APPROVED"].includes(submission.attributes?.betaReviewState)
  );
  let reviewSubmissionStatus = 200;
  if (!activeSubmission) {
    const submitted = requireSuccess(await request("POST", "/v1/betaAppReviewSubmissions", {
      body: {
        data: {
          type: "betaAppReviewSubmissions",
          relationships: { build: { data: { type: "builds", id: build.id } } }
        }
      }
    }), "Unable to submit the build for external TestFlight review");
    reviewSubmissionStatus = submitted.status;
  }

  const [detail, finalSubmissions] = await Promise.all([
    request("GET", `/v1/builds/${build.id}/buildBetaDetail`, {
      params: { "fields[buildBetaDetails]": "autoNotifyEnabled,internalBuildState,externalBuildState" }
    }),
    getReviewSubmissions(build.id)
  ]);

  console.log(JSON.stringify({
    app: { id: app.id, ...app.attributes },
    build: { id: build.id, ...build.attributes },
    betaGroup: { id: group.id, ...group.attributes },
    buildLocalizationStatus: localization.status,
    groupBuildStatus,
    reviewSubmissionStatus,
    betaDetail: item(detail),
    reviewSubmissions: items(finalSubmissions),
    publicLink: group.attributes.publicLink,
    apiErrors: errors(detail, finalSubmissions)
  }, null, 2));
}

if (process.argv.includes("--builds")) {
  await inspectBuilds();
} else if (process.argv.includes("--inspect-external") || process.argv.includes("--testflight")) {
  await inspectExternal();
} else if (process.argv.includes("--submit-external")) {
  await submitExternal();
} else {
  throw new Error("Usage: CheckAppStoreConnect.sh --builds | --inspect-external | --submit-external");
}
