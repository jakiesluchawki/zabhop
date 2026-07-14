const PLAN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_PAYLOAD_CHARS = 4_096;
const MAX_PAYLOAD_BYTES = 3_072;
const MAX_REQUEST_BYTES = 4_608;
// 96 bits makes collisions fantastically unlikely while keeping the visible
// `#p/<token>` link short enough for message clients to treat as a URL.
const TOKEN_BYTES = 12;
const TOKEN_LENGTH = 16;
const MAX_TOKEN_ATTEMPTS = 5;
const MIN_TIMESTAMP_MINUTE = 20_000_000;
const MAX_TIMESTAMP_MINUTE = 100_000_000;

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const TOKEN_RE = new RegExp(`^[A-Za-z0-9_-]{${TOKEN_LENGTH}}$`);
const TOKEN_PATH_RE = new RegExp(`^/plans/([A-Za-z0-9_-]{${TOKEN_LENGTH}})$`);
const PLAN_STORE_NAME = "energylandia-short-plans-v1";

// The compact payload intentionally refers only to app-owned IDs. This stops
// the endpoint becoming generic short-term storage while keeping the Worker
// independent of the static frontend bundle.
const ATTRACTION_IDS = new Set([
  "honey-harbour", "bumble-boats", "mokate-twist", "bon-bon-balloon", "candy-carousel", "crazy-barn",
  "choco-chip-creek", "abyssus", "whirlpool-water-fight", "light-explorers", "stormy-ship",
  "grotto-expedition", "frida", "wonder-wheel", "formula", "formula-autodrom", "anaconda", "rmf-dragon",
  "viking-ride", "monster-house", "swiss-water-cups", "atlantis", "boomerang", "splash-battle",
  "gold-mine", "frutti-loop", "energus", "jungle-adventure", "zadra", "mayan", "tsunami-drop",
  "aztec-swing", "viking", "space-gun", "apocalypto", "space-booster", "speed", "hyperion",
]);
const RESTAURANT_IDS = new Set(["napoli", "formula-restaurant", "formula-pizza", "scandinavia"]);
const SHOW_IDS = new Set([
  "around-the-world-robots-show", "energylandia-express", "extreme-energylandia-the-adrenaline-show",
  "extreme-energylandia-the-challenge-show", "energylandia-extreme-show-2", "fire-show",
  "funny-in-sweet-valley-show", "parada", "piraci-z-zatoki-67", "planetarium", "pokaz-fajerwerkow",
  "pyramid-cinema-7d", "spotkanie-z-maskotkami", "teatr-egipt", "the-balloons-party-show",
  "the-book-of-magic", "toffee-theatre", "zaloga-na-poklad",
]);

// RPC requires a real Cloudflare DurableObject base class. Keeping the import
// dynamic lets the HTTP/schema contract run under Node's built-in test runner;
// Wrangler bundles the Cloudflare branch for the deployed Worker.
const DurableObjectBase = globalThis.__ENERGYLANDIA_SHORTLINK_NODE_TEST__
  ? class {}
  : (await import("cloudflare:workers")).DurableObject;

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactlyKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function safeInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function planMinute(value) {
  return safeInteger(value, 0, 1_439);
}

function walkingMinutes(value) {
  return safeInteger(value, 0, 180);
}

function printableText(value, maximumLength) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= maximumLength
    && /^[\p{L}\p{N}\p{P}\p{Zs}]+$/u.test(value);
}

function validDateCode(value) {
  if (value === 0) return true;
  if (!safeInteger(value, 20_000_101, 2_100_1231)) return false;
  const compact = String(value);
  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function validTimestampMinute(value, { required = false } = {}) {
  return value === 0 ? !required : safeInteger(value, MIN_TIMESTAMP_MINUTE, MAX_TIMESTAMP_MINUTE);
}

function decodeBase64Url(payload) {
  if (payload.length % 4 === 1) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes.byteLength > MAX_PAYLOAD_BYTES) return null;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function validateMembers(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 14) return false;
  let adultPresent = false;
  return value.every((member) => {
    if (!Array.isArray(member) || member.length !== 3) return false;
    const [role, age, height] = member;
    if (role !== 0 && role !== 1) return false;
    if (!safeInteger(age, 0, 110) || !safeInteger(height, 50, 230)) return false;
    if (role === 0 && age >= 18) adultPresent = true;
    return true;
  }) && adultPresent;
}

function validateProfile(profile) {
  if (!Array.isArray(profile) || profile.length !== 13) return null;
  const [date, arrival, departure, pace, splitPolicy, intensity, interests, wet, maxQueue, mealMode, mealTime, includeShows, members] = profile;
  if (
    !validDateCode(date)
    || !planMinute(arrival)
    || !planMinute(departure)
    || departure <= arrival
    || !["e", "n", "f"].includes(pace)
    || !["n", "w", "o"].includes(splitPolicy)
    || !["c", "m", "t"].includes(intensity)
    || !safeInteger(interests, 0, 15)
    || !["a", "o", "w"].includes(wet)
    || !safeInteger(maxQueue, 15, 90)
    || !["f", "s", "o", "n"].includes(mealMode)
    || !planMinute(mealTime)
    || (includeShows !== 0 && includeShows !== 1)
    || !validateMembers(members)
  ) return null;
  return { mealMode, memberCount: members.length };
}

function validTimeRange(start, end, previousEnd) {
  return planMinute(start) && planMinute(end) && end > start && end <= 1_440 && start >= previousEnd;
}

function validateStep(step, context) {
  if (!Array.isArray(step) || typeof step[0] !== "string") return null;
  const kind = step[0];

  if (kind === "r" && step.length === 6) {
    const [, attractionId, start, end, walking, queue] = step;
    if (!ATTRACTION_IDS.has(attractionId) || !validTimeRange(start, end, context.previousEnd) || !walkingMinutes(walking) || (queue !== -1 && !safeInteger(queue, 0, 600))) return null;
    return end;
  }

  if (kind === "m" && step.length === 5) {
    const [, restaurantId, start, end, walking] = step;
    if (
      typeof restaurantId !== "string"
      || (restaurantId !== "" && !RESTAURANT_IDS.has(restaurantId))
      || (restaurantId === "" && context.mealMode !== "o")
      || !validTimeRange(start, end, context.previousEnd)
      || !walkingMinutes(walking)
    ) return null;
    return end;
  }

  if (kind === "f" && step.length === 5) {
    const [, start, end, unplannedUntil, backups] = step;
    if (
      !validTimeRange(start, end, context.previousEnd)
      || (unplannedUntil !== 0 && (!planMinute(unplannedUntil) || unplannedUntil <= end))
      || !Array.isArray(backups)
      || backups.length > 3
      || backups.some((attractionId) => !ATTRACTION_IDS.has(attractionId))
      || new Set(backups).size !== backups.length
    ) return null;
    return end;
  }

  if (kind === "h" && step.length === 11) {
    const [, showId, title, venue, mapLocation, start, performanceStart, duration, performanceTimes, sourceCheckedAt, walking] = step;
    const showEnd = Number.isSafeInteger(performanceStart) && Number.isSafeInteger(duration) ? performanceStart + duration : null;
    if (
      !SHOW_IDS.has(showId)
      || !printableText(title, 140)
      || !printableText(venue, 140)
      || typeof mapLocation !== "string"
      || !/^[a-z0-9_-]{1,80}$/i.test(mapLocation)
      || !planMinute(start)
      || !planMinute(performanceStart)
      || performanceStart < start
      || !safeInteger(duration, 5, 180)
      || showEnd === null
      || showEnd > 1_440
      || start < context.previousEnd
      || !Array.isArray(performanceTimes)
      || performanceTimes.length < 1
      || performanceTimes.length > 16
      || performanceTimes.some((time) => !planMinute(time))
      || new Set(performanceTimes).size !== performanceTimes.length
      || !performanceTimes.includes(performanceStart)
      || !validTimestampMinute(sourceCheckedAt, { required: true })
      || !walkingMinutes(walking)
    ) return null;
    return showEnd;
  }

  if (kind === "s" && step.length === 7) {
    const [, firstAttractionId, secondAttractionId, start, end, walking, memberMask] = step;
    const maximumMask = (2 ** context.memberCount) - 1;
    if (
      !ATTRACTION_IDS.has(firstAttractionId)
      || !ATTRACTION_IDS.has(secondAttractionId)
      || firstAttractionId === secondAttractionId
      || !validTimeRange(start, end, context.previousEnd)
      || !walkingMinutes(walking)
      || !safeInteger(memberMask, 1, maximumMask - 1)
    ) return null;
    return end;
  }

  return null;
}

function validateDay(day, context) {
  if (!Array.isArray(day) || day.length < 1 || day.length > 15) return false;
  let previousEnd = 0;
  for (const step of day) {
    const end = validateStep(step, { ...context, previousEnd });
    if (end === null) return false;
    previousEnd = end;
  }
  return true;
}

/**
 * Validate the app's anonymous compact v2 share representation. Returning a
 * boolean (rather than transformed data) means the Worker stores the exact
 * payload that the frontend knows how to decode.
 */
export function validateCompactV2Payload(payload) {
  if (typeof payload !== "string" || payload.length < 24 || payload.length > MAX_PAYLOAD_CHARS || !BASE64URL_RE.test(payload)) return false;
  const decoded = decodeBase64Url(payload);
  if (!decoded) return false;

  let snapshot;
  try {
    snapshot = JSON.parse(decoded);
  } catch {
    return false;
  }

  if (!isPlainRecord(snapshot) || !hasExactlyKeys(snapshot, ["v", "p", "t", "d"]) || snapshot.v !== 2) return false;
  const profile = validateProfile(snapshot.p);
  if (
    !profile
    || !Array.isArray(snapshot.t)
    || snapshot.t.length !== 2
    || !validTimestampMinute(snapshot.t[0], { required: true })
    || !validTimestampMinute(snapshot.t[1])
    || !Array.isArray(snapshot.d)
    || snapshot.d.length < 1
    || snapshot.d.length > 3
  ) return false;

  return snapshot.d.every((day) => validateDay(day, profile));
}

function base64UrlToken(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function createPlanToken() {
  return base64UrlToken(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

function allowedOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.origin === "https://jakiesluchawki.github.io") return url.origin;
    const localDevelopmentHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (localDevelopmentHost && (url.protocol === "http:" || url.protocol === "https:")) return url.origin;
  } catch {
    // Treat malformed Origins like any other untrusted browser origin.
  }
  return false;
}

function responseJson(payload, status, origin = null, extraHeaders = {}) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

function corsPreflight(origin) {
  if (!origin) return responseJson({ error: "origin_not_allowed" }, 403);
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    },
  });
}

async function readCreatePayload(request) {
  const contentType = request.headers.get("Content-Type") || "";
  const contentLength = Number(request.headers.get("Content-Length"));
  if (!contentType.toLowerCase().startsWith("application/json")) return { error: "unsupported_media_type", status: 415 };
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) return { error: "payload_too_large", status: 413 };

  let text;
  try {
    text = await request.text();
  } catch {
    return { error: "invalid_json", status: 400 };
  }
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) return { error: "payload_too_large", status: 413 };

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { error: "invalid_json", status: 400 };
  }
  if (!isPlainRecord(body) || !hasExactlyKeys(body, ["payload"]) || !validateCompactV2Payload(body.payload)) {
    return { error: "invalid_plan", status: 422 };
  }
  return { payload: body.payload };
}

function singletonPlanStore(env) {
  return env.PLAN_STORE.get(env.PLAN_STORE.idFromName(PLAN_STORE_NAME));
}

export async function handleRequest(request, env) {
  const origin = allowedOrigin(request);
  if (request.method === "OPTIONS") return corsPreflight(origin);
  if (origin === false) return responseJson({ error: "origin_not_allowed" }, 403);

  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/plans") {
    // Creation requires a browser Origin from the deployed app or local dev.
    // GET remains usable from a pasted browser URL and direct diagnostic tools.
    if (!origin) return responseJson({ error: "origin_required" }, 403);
    const parsed = await readCreatePayload(request);
    if (!parsed.payload) return responseJson({ error: parsed.error }, parsed.status, origin);
    try {
      const result = await singletonPlanStore(env).createPlan(parsed.payload);
      if (!result || !TOKEN_RE.test(result.token)) throw new Error("invalid_token_from_store");
      return responseJson({ token: result.token }, 201, origin);
    } catch {
      return responseJson({ error: "storage_unavailable" }, 503, origin);
    }
  }

  const tokenMatch = url.pathname.match(TOKEN_PATH_RE);
  if (request.method === "GET" && tokenMatch) {
    try {
      const payload = await singletonPlanStore(env).getPlan(tokenMatch[1]);
      return payload
        ? responseJson({ payload }, 200, origin)
        : responseJson({ error: "not_found" }, 404, origin);
    } catch {
      return responseJson({ error: "storage_unavailable" }, 503, origin);
    }
  }

  return responseJson({ error: "not_found" }, 404, origin);
}

/**
 * Singleton Durable Object holding anonymous compact plans in embedded SQLite.
 * A Durable Object serializes mutations, so a successful POST is immediately
 * readable by the matching GET from another device — unlike eventually
 * consistent Workers KV.
 */
export class PlanStore extends DurableObjectBase {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        token TEXT PRIMARY KEY NOT NULL,
        payload TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS plans_expiry ON plans(expires_at);
    `);
  }

  purgeExpired(now = Date.now()) {
    this.sql.exec("DELETE FROM plans WHERE expires_at <= ?", now);
  }

  nextExpiry() {
    return this.sql.exec("SELECT MIN(expires_at) AS expires_at FROM plans").toArray()[0]?.expires_at ?? null;
  }

  async scheduleExpiryAlarm() {
    const nextExpiry = Number(this.nextExpiry());
    if (Number.isSafeInteger(nextExpiry) && nextExpiry > Date.now()) {
      await this.ctx.storage.setAlarm(nextExpiry);
    }
  }

  async createPlan(payload) {
    if (!validateCompactV2Payload(payload)) throw new Error("invalid_plan");
    const now = Date.now();
    const expiresAt = now + PLAN_TTL_MS;
    this.purgeExpired(now);

    for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt += 1) {
      const token = createPlanToken();
      const existing = this.sql.exec("SELECT token FROM plans WHERE token = ? LIMIT 1", token).toArray()[0];
      if (existing) continue;
      this.sql.exec("INSERT INTO plans (token, payload, expires_at) VALUES (?, ?, ?)", token, payload, expiresAt);
      await this.scheduleExpiryAlarm();
      return { token };
    }
    throw new Error("token_collision_limit");
  }

  async getPlan(token) {
    if (!TOKEN_RE.test(token)) return null;
    const now = Date.now();
    this.purgeExpired(now);
    const row = this.sql.exec("SELECT payload, expires_at FROM plans WHERE token = ? LIMIT 1", token).toArray()[0];
    if (!row || Number(row.expires_at) <= now || typeof row.payload !== "string") return null;
    // Defensive re-validation means even a manually altered database entry
    // cannot turn this service into arbitrary cross-origin storage.
    return validateCompactV2Payload(row.payload) ? row.payload : null;
  }

  async alarm() {
    this.purgeExpired();
    await this.scheduleExpiryAlarm();
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
