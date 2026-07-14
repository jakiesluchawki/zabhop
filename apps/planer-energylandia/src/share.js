import { ALL_ATTRACTIONS_BY_ID, RESTAURANTS } from "./extendedData.js";
import { formatPlanTime, timeToMinutes, validatePlanSafety } from "./planner.js";

const MAX_MEMBERS = 14;
// Jeden dobrowolny pokaz może wejść do trasy, ale nie powinien zjadać miejsca
// na którykolwiek z podstawowych kroków dnia.
const MAX_STEPS_PER_DAY = 15;
const RESTAURANT_IDS = new Set(RESTAURANTS.map((restaurant) => restaurant.id));
const RESTAURANTS_BY_ID = Object.fromEntries(RESTAURANTS.map((restaurant) => [restaurant.id, restaurant]));
const VALID_INTERESTS = new Set(["coasters", "water", "family", "scenic"]);

// Link udostępnienia nie potrzebuje kopiować pełnej, opisowej wersji planu.
// Atrakcje i restauracje są już w aplikacji, więc w v2 przenosimy tylko
// znaczenie trasy (ID, czasy i bezpieczne przypisania). To mieści plan w
// komunikatorach bez backendu i bez przekazywania imion.
const COMPACT_SHARE_VERSION = 2;
const COMPACT_TIMESTAMP_MINUTE_MIN = 20_000_000;
const COMPACT_TIMESTAMP_MINUTE_MAX = 100_000_000;
const PACE_TO_CODE = Object.freeze({ easy: "e", normal: "n", fast: "f" });
const CODE_TO_PACE = Object.freeze({ e: "easy", n: "normal", f: "fast" });
const SPLIT_TO_CODE = Object.freeze({ never: "n", worthwhile: "w", often: "o" });
const CODE_TO_SPLIT = Object.freeze({ n: "never", w: "worthwhile", o: "often" });
const INTENSITY_TO_CODE = Object.freeze({ calm: "c", mixed: "m", thrill: "t" });
const CODE_TO_INTENSITY = Object.freeze({ c: "calm", m: "mixed", t: "thrill" });
const WET_TO_CODE = Object.freeze({ avoid: "a", ok: "o", want: "w" });
const CODE_TO_WET = Object.freeze({ a: "avoid", o: "ok", w: "want" });
const MEAL_TO_CODE = Object.freeze({ fast: "f", "sit-down": "s", own: "o", none: "n" });
const CODE_TO_MEAL = Object.freeze({ f: "fast", s: "sit-down", o: "own", n: "none" });
const INTEREST_BITS = Object.freeze({ coasters: 1, water: 2, family: 4, scenic: 8 });
const COMPACT_SHOW_DESCRIPTION = "Pełny, oficjalny opis i aktualne godziny są w kalendarzu pokazów Energylandii w aplikacji.";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteOr(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function validTime(value, fallback) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
}

function validDateKey(value) {
  const key = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const parsed = new Date(`${key}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === key ? key : null;
}

function validIsoTimestamp(value) {
  if (
    typeof value !== "string"
    || value.length > 48
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
  ) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  try {
    // Normalizujemy do jednego, jednoznacznego ISO. Dzięki temu payload nie
    // przenosi lokalnych stref ani nieprawidłowych dat, które Date potrafi
    // czasem „naprawić” przez przesunięcie miesiąca.
    return new Date(parsed).toISOString();
  } catch {
    return null;
  }
}

function officialEnergylandiaUrl(value, pathnameCheck) {
  if (typeof value !== "string" || value.length > 600) return null;
  try {
    const url = new URL(value);
    const officialHost = url.protocol === "https:"
      && (url.hostname === "energylandia.pl" || url.hostname === "www.energylandia.pl");
    if (!officialHost || !pathnameCheck(url)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function officialShowUrl(value) {
  return officialEnergylandiaUrl(value, (url) => /^\/show\/[^/?#]+\/?$/.test(url.pathname));
}

function officialParkMapUrl(value) {
  return officialEnergylandiaUrl(value, (url) => {
    if (!/^\/mapa-parku\/?$/.test(url.pathname)) return false;
    const location = url.searchParams.get("location");
    return Boolean(location) && /^[a-z0-9_-]{1,80}$/i.test(location);
  });
}

function officialImageUrl(value) {
  if (typeof value !== "string" || value.length > 600) return null;
  try {
    const url = new URL(value);
    const officialHost = url.protocol === "https:"
      && (url.hostname === "energylandia.pl" || url.hostname.endsWith(".energylandia.pl"));
    return officialHost ? url.toString() : null;
  } catch {
    return null;
  }
}

function cleanRequiredText(value, maxLength) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ").slice(0, maxLength);
  return cleaned || null;
}

function cleanShowTimes(value, selectedTime) {
  if (value === undefined || value === null) return [formatPlanTime(selectedTime)];
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) return null;
  const times = value.map((time) => validTime(time, null));
  if (times.some((time) => time === null)) return null;
  const unique = [...new Set(times)].sort((left, right) => timeToMinutes(left, 0) - timeToMinutes(right, 0));
  return unique.includes(formatPlanTime(selectedTime)) ? unique : null;
}

function planMinute(value) {
  const minute = finiteOr(value, NaN);
  return Number.isInteger(minute) && minute >= 0 && minute < 24 * 60 ? minute : null;
}

function toBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function integerInRange(value, minimum, maximum) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function compactMinute(value, fallback = 0) {
  const minute = Math.round(finiteOr(value, fallback));
  return integerInRange(minute, 0, 1439);
}

function compactWalkingMinutes(value) {
  const minutes = Math.round(finiteOr(value, 0));
  return integerInRange(minutes, 0, 180);
}

function compactDate(value) {
  const date = validDateKey(value);
  return date ? Number(date.replaceAll("-", "")) : 0;
}

function expandCompactDate(value) {
  if (value === 0) return null;
  const compact = integerInRange(value, 10_001_01, 99_991_231);
  if (compact === null) return null;
  const date = String(compact).padStart(8, "0");
  return validDateKey(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`);
}

function compactTimestamp(value) {
  const timestamp = Date.parse(value ?? "");
  if (!Number.isFinite(timestamp)) return 0;
  return Math.floor(timestamp / 60_000);
}

function expandCompactTimestamp(value, { required = false } = {}) {
  if (value === 0 && !required) return null;
  const minute = integerInRange(value, COMPACT_TIMESTAMP_MINUTE_MIN, COMPACT_TIMESTAMP_MINUTE_MAX);
  return minute === null ? null : new Date(minute * 60_000).toISOString();
}

function interestsToMask(interests) {
  return (Array.isArray(interests) ? interests : []).reduce((mask, interest) => mask | (INTEREST_BITS[interest] ?? 0), 0);
}

function interestsFromMask(value) {
  const mask = integerInRange(value, 0, 15);
  if (mask === null) return null;
  return Object.entries(INTEREST_BITS)
    .filter(([, bit]) => (mask & bit) === bit)
    .map(([interest]) => interest);
}

function compactMapLocation(value) {
  try {
    const location = new URL(value).searchParams.get("location");
    return location && /^[a-z0-9_-]{1,80}$/i.test(location) ? location : null;
  } catch {
    return null;
  }
}

function anonymousCompactMembers(members) {
  const roleCounts = { adult: 0, child: 0 };
  const idToIndex = new Map();
  const compactMembers = members.map((member, index) => {
    roleCounts[member.role] += 1;
    idToIndex.set(member.id, index);
    return [member.role === "adult" ? 0 : 1, Math.round(member.age), Math.round(member.height)];
  });
  return { compactMembers, idToIndex };
}

function compactMemberMask(ids, idToIndex) {
  if (!Array.isArray(ids)) return null;
  let mask = 0;
  for (const id of ids) {
    const index = idToIndex.get(id);
    if (!Number.isInteger(index) || index < 0 || index >= MAX_MEMBERS) return null;
    const bit = 2 ** index;
    if (mask & bit) return null;
    mask += bit;
  }
  return mask;
}

function compactStep(step, { idToIndex }) {
  const startMin = compactMinute(step.startMin);
  const endMin = compactMinute(step.endMin);
  const walkingMinutes = compactWalkingMinutes(step.walkingMinutes);
  if (startMin === null || endMin === null || walkingMinutes === null || endMin <= startMin) return null;

  if (step.kind === "ride") {
    const queueMinutes = step.queueMinutes === null || step.queueMinutes === undefined
      ? -1
      : integerInRange(Math.round(finiteOr(step.queueMinutes, NaN)), 0, 600);
    if (!ALL_ATTRACTIONS_BY_ID[step.attractionId] || queueMinutes === null) return null;
    return ["r", step.attractionId, startMin, endMin, walkingMinutes, queueMinutes];
  }

  if (step.kind === "meal") {
    const restaurantId = step.restaurantId ?? "";
    if (restaurantId !== "" && !RESTAURANT_IDS.has(restaurantId)) return null;
    return ["m", restaurantId, startMin, endMin, walkingMinutes];
  }

  if (step.kind === "flex") {
    const unplannedUntil = step.unplannedUntil === null || step.unplannedUntil === undefined
      ? 0
      : compactMinute(step.unplannedUntil);
    const backupAttractionIds = Array.isArray(step.backupAttractionIds) ? step.backupAttractionIds : [];
    if (
      unplannedUntil === null
      || backupAttractionIds.length > 3
      || backupAttractionIds.some((id) => !ALL_ATTRACTIONS_BY_ID[id])
      || new Set(backupAttractionIds).size !== backupAttractionIds.length
    ) return null;
    return ["f", startMin, endMin, unplannedUntil, backupAttractionIds];
  }

  if (step.kind === "show") {
    const showId = String(step.showId || "");
    const title = cleanRequiredText(step.title, 140);
    const venue = cleanRequiredText(step.venue, 140);
    const mapLocation = compactMapLocation(step.mapUrl);
    const performanceStartMin = compactMinute(step.performanceStartMin);
    const durationMinutes = integerInRange(Math.round(finiteOr(step.durationMinutes, NaN)), 5, 180);
    const sourceCheckedAt = compactTimestamp(step.sourceCheckedAt);
    const performanceTimes = Array.isArray(step.performanceTimes)
      ? step.performanceTimes.map((time) => timeToMinutes(time, -1))
      : [];
    if (
      !/^[a-z0-9][a-z0-9-]{0,99}$/i.test(showId)
      || !title
      || !venue
      || !mapLocation
      || performanceStartMin === null
      || durationMinutes === null
      || sourceCheckedAt === 0
      || performanceTimes.length < 1
      || performanceTimes.length > 16
      || performanceTimes.some((time) => integerInRange(time, 0, 1439) === null)
      || !performanceTimes.includes(performanceStartMin)
      || endMin !== performanceStartMin + durationMinutes
    ) return null;
    return ["h", showId, title, venue, mapLocation, startMin, performanceStartMin, durationMinutes, performanceTimes, sourceCheckedAt, walkingMinutes];
  }

  if (step.kind === "split") {
    const assignments = Array.isArray(step.assignments) ? step.assignments : [];
    const first = assignments[0];
    const second = assignments[1];
    const firstMask = compactMemberMask(first?.memberIds, idToIndex);
    if (
      assignments.length !== 2
      || !ALL_ATTRACTIONS_BY_ID[first?.attractionId]
      || !ALL_ATTRACTIONS_BY_ID[second?.attractionId]
      || firstMask === null
    ) return null;
    return ["s", first.attractionId, second.attractionId, startMin, endMin, walkingMinutes, firstMask];
  }

  return null;
}

function compactSnapshotFromPlan(sanitized) {
  const { compactMembers, idToIndex } = anonymousCompactMembers(sanitized.profile.members);
  const profile = sanitized.profile;
  const days = sanitized.days.map((day) => day.steps.map((step) => compactStep(step, { idToIndex })));
  if (days.some((steps) => steps.some((step) => step === null))) return null;
  const generatedAt = compactTimestamp(sanitized.generatedAt);
  if (generatedAt === 0) return null;

  return {
    v: COMPACT_SHARE_VERSION,
    p: [
      compactDate(profile.visitStartDate),
      timeToMinutes(profile.arrivalTime, -1),
      timeToMinutes(profile.departureTime, -1),
      PACE_TO_CODE[profile.pace],
      SPLIT_TO_CODE[profile.splitPolicy],
      INTENSITY_TO_CODE[profile.preferences.intensity],
      interestsToMask(profile.preferences.interests),
      WET_TO_CODE[profile.preferences.wet],
      Math.round(profile.preferences.maxQueue),
      MEAL_TO_CODE[profile.meal.mode],
      timeToMinutes(profile.meal.time, -1),
      profile.entertainment.includeShows ? 1 : 0,
      compactMembers,
    ],
    t: [generatedAt, compactTimestamp(sanitized.queueSnapshotAt ? new Date(sanitized.queueSnapshotAt).toISOString() : null)],
    d: days,
  };
}

function expandCompactMembers(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MEMBERS) return null;
  const roleCounts = { adult: 0, child: 0 };
  const members = [];
  for (const tuple of value) {
    if (!Array.isArray(tuple) || tuple.length !== 3) return null;
    const role = tuple[0] === 0 ? "adult" : tuple[0] === 1 ? "child" : null;
    const age = integerInRange(tuple[1], 0, 110);
    const height = integerInRange(tuple[2], 50, 230);
    if (!role || age === null || height === null) return null;
    roleCounts[role] += 1;
    members.push({
      id: `${role}-${roleCounts[role]}`,
      role,
      name: role === "adult" ? `Dorosły ${roleCounts[role]}` : `Dziecko ${roleCounts[role]}`,
      age,
      height,
    });
  }
  return members;
}

function memberIdsFromMask(mask, members) {
  const maximumMask = 2 ** members.length - 1;
  if (integerInRange(mask, 1, maximumMask) === null) return null;
  return members.filter((member, index) => (mask & (2 ** index)) !== 0).map((member) => member.id);
}

function expandedCompactStep(entry, { dayIndex, stepIndex, profile, members, previousKind }) {
  if (!Array.isArray(entry) || typeof entry[0] !== "string") return null;
  const kind = entry[0];
  const startMin = compactMinute(entry[kind === "h" ? 5 : kind === "s" ? 3 : kind === "r" || kind === "m" ? 2 : 1]);
  // Pokaz zapisuje start występu i czas trwania (bez nadmiarowego endMin),
  // więc jego koniec obliczamy niżej z tych dwóch wartości.
  const endMin = kind === "h"
    ? null
    : compactMinute(entry[kind === "s" ? 4 : kind === "r" || kind === "m" ? 3 : 2]);
  const walkingMinutes = compactWalkingMinutes(entry[kind === "h" ? 10 : kind === "s" ? 5 : kind === "r" || kind === "m" ? 4 : 0]);
  if (startMin === null || (kind !== "h" && (endMin === null || endMin <= startMin)) || (kind !== "f" && walkingMinutes === null)) return null;

  if (kind === "r" && entry.length === 6) {
    const attraction = ALL_ATTRACTIONS_BY_ID[entry[1]];
    const queueMinutes = entry[5] === -1 ? null : integerInRange(entry[5], 0, 600);
    if (!attraction || queueMinutes === null && entry[5] !== -1) return null;
    return {
      id: `day-${dayIndex + 1}-ride-${attraction.id}`,
      kind: "ride",
      attractionId: attraction.id,
      zone: attraction.zone,
      routeOrder: attraction.routeOrder,
      score: 0,
      why: "",
      startMin,
      endMin,
      walkingMinutes,
      queueMinutes,
      memberIds: members.map((member) => member.id),
    };
  }

  if (kind === "m" && entry.length === 5) {
    const restaurantId = entry[1] || null;
    const restaurant = restaurantId ? RESTAURANTS_BY_ID[restaurantId] : null;
    if ((restaurantId && !restaurant) || (!restaurant && profile.meal.mode !== "own")) return null;
    return {
      id: `day-${dayIndex + 1}-meal`,
      kind: "meal",
      restaurantId,
      title: restaurant?.name ?? "Przerwa na własny prowiant",
      description: restaurant?.description ?? "Spokojna przerwa bez szukania restauracji.",
      zone: restaurant?.zone ?? "family-zone",
      startMin,
      endMin,
      walkingMinutes,
    };
  }

  if (kind === "f" && entry.length === 5) {
    const unplannedUntil = entry[3] === 0 ? null : compactMinute(entry[3]);
    const backupAttractionIds = entry[4];
    if (
      unplannedUntil === null && entry[3] !== 0
      || !Array.isArray(backupAttractionIds)
      || backupAttractionIds.length > 3
      || backupAttractionIds.some((id) => !ALL_ATTRACTIONS_BY_ID[id])
      || new Set(backupAttractionIds).size !== backupAttractionIds.length
    ) return null;
    const afterShow = previousKind === "show";
    return {
      id: `day-${dayIndex + 1}-${afterShow ? "flex-after-show" : "flex"}`,
      kind: "flex",
      title: afterShow ? "Bufor po pokazie" : "Bufor na prawdziwy park",
      description: afterShow
        ? "Pokaz nie skraca rdzenia trasy. Nadal zostawiamy czas na kolejki, WC, odpoczynek i bezpieczne domknięcie dnia."
        : "Kolejki, toalety, odpoczynek i spontaniczne decyzje — tego bloku celowo nie wypełniamy co do minuty.",
      startMin,
      endMin,
      unplannedUntil,
      backupAttractionIds,
    };
  }

  if (kind === "h" && entry.length === 11) {
    const showId = String(entry[1] || "");
    const title = cleanRequiredText(entry[2], 140);
    const venue = cleanRequiredText(entry[3], 140);
    const mapLocation = String(entry[4] || "");
    const performanceStartMin = compactMinute(entry[6]);
    const durationMinutes = integerInRange(entry[7], 5, 180);
    const performanceTimes = Array.isArray(entry[8])
      ? entry[8].map((time) => compactMinute(time)).filter((time) => time !== null)
      : [];
    const sourceCheckedAt = expandCompactTimestamp(entry[9], { required: true });
    const showEndMin = performanceStartMin === null || durationMinutes === null ? null : performanceStartMin + durationMinutes;
    if (
      !/^[a-z0-9][a-z0-9-]{0,99}$/i.test(showId)
      || !title
      || !venue
      || !/^[a-z0-9_-]{1,80}$/i.test(mapLocation)
      || performanceStartMin === null
      || durationMinutes === null
      || performanceTimes.length < 1
      || performanceTimes.length > 16
      || new Set(performanceTimes).size !== performanceTimes.length
      || !performanceTimes.includes(performanceStartMin)
      || !sourceCheckedAt
      || showEndMin === null
      || showEndMin >= 24 * 60
    ) return null;
    return {
      id: `day-${dayIndex + 1}-show-${showId}-${performanceStartMin}`,
      kind: "show",
      showId,
      title,
      description: COMPACT_SHOW_DESCRIPTION,
      venue,
      officialUrl: `https://energylandia.pl/show/${showId}/`,
      mapUrl: `https://energylandia.pl/mapa-parku/?location=${encodeURIComponent(mapLocation)}`,
      performanceTimes: performanceTimes.map(formatPlanTime),
      sourceCheckedAt,
      startMin,
      performanceStartMin,
      endMin: showEndMin,
      durationMinutes,
      walkingMinutes,
    };
  }

  if (kind === "s" && entry.length === 7) {
    const mainAttraction = ALL_ATTRACTIONS_BY_ID[entry[1]];
    const alternativeAttraction = ALL_ATTRACTIONS_BY_ID[entry[2]];
    const firstMemberIds = memberIdsFromMask(entry[6], members);
    const firstMask = integerInRange(entry[6], 1, 2 ** members.length - 1);
    const secondMemberIds = firstMask === null ? null : memberIdsFromMask((2 ** members.length - 1) - firstMask, members);
    if (!mainAttraction || !alternativeAttraction || !firstMemberIds || !secondMemberIds) return null;
    return {
      id: `day-${dayIndex + 1}-split-${mainAttraction.id}`,
      kind: "split",
      attractionId: mainAttraction.id,
      alternativeAttractionId: alternativeAttraction.id,
      zone: mainAttraction.zone,
      routeOrder: mainAttraction.routeOrder,
      score: 0,
      startMin,
      endMin,
      walkingMinutes,
      assignments: [
        { label: "Mocniejsza trasa", attractionId: mainAttraction.id, memberIds: firstMemberIds },
        { label: "Trasa równoległa", attractionId: alternativeAttraction.id, memberIds: secondMemberIds },
      ],
      reunion: { label: `Spotkanie przy ${mainAttraction.name}`, time: formatPlanTime(endMin) },
    };
  }

  return null;
}

function expandCompactSnapshot(snapshot) {
  if (!isRecord(snapshot) || snapshot.v !== COMPACT_SHARE_VERSION || !Array.isArray(snapshot.p) || snapshot.p.length !== 13 || !Array.isArray(snapshot.t) || snapshot.t.length !== 2 || !Array.isArray(snapshot.d) || snapshot.d.length < 1 || snapshot.d.length > 3) return null;
  const [date, arrival, departure, paceCode, splitCode, intensityCode, interestMask, wetCode, maxQueue, mealCode, mealTime, includeShows, compactMembers] = snapshot.p;
  const visitStartDate = expandCompactDate(date);
  const arrivalMinute = compactMinute(arrival);
  const departureMinute = compactMinute(departure);
  const interests = interestsFromMask(interestMask);
  const members = expandCompactMembers(compactMembers);
  const generatedAt = expandCompactTimestamp(snapshot.t[0], { required: true });
  const queueCheckedAt = expandCompactTimestamp(snapshot.t[1]);
  const pace = CODE_TO_PACE[paceCode];
  const splitPolicy = CODE_TO_SPLIT[splitCode];
  const intensity = CODE_TO_INTENSITY[intensityCode];
  const wet = CODE_TO_WET[wetCode];
  const mealMode = CODE_TO_MEAL[mealCode];
  const requestedMealMinute = compactMinute(mealTime);
  if (
    (date !== 0 && !visitStartDate)
    || arrivalMinute === null
    || departureMinute === null
    || !interests
    || !members
    || !generatedAt
    || !pace
    || !splitPolicy
    || !intensity
    || !wet
    || !mealMode
    || requestedMealMinute === null
    || includeShows !== 0 && includeShows !== 1
    || integerInRange(maxQueue, 15, 90) === null
  ) return null;
  const profile = {
    dayCount: snapshot.d.length,
    visitStartDate,
    arrivalTime: formatPlanTime(arrivalMinute),
    departureTime: formatPlanTime(departureMinute),
    pace,
    splitPolicy,
    preferences: { intensity, interests, wet, maxQueue },
    meal: { mode: mealMode, time: formatPlanTime(requestedMealMinute) },
    entertainment: { includeShows: includeShows === 1 },
    members,
  };
  const days = [];
  for (let dayIndex = 0; dayIndex < snapshot.d.length; dayIndex += 1) {
    const compactSteps = snapshot.d[dayIndex];
    if (!Array.isArray(compactSteps) || compactSteps.length > MAX_STEPS_PER_DAY) return null;
    const steps = [];
    let previousKind = null;
    for (let stepIndex = 0; stepIndex < compactSteps.length; stepIndex += 1) {
      const step = expandedCompactStep(compactSteps[stepIndex], { dayIndex, stepIndex, profile, members, previousKind });
      if (!step) return null;
      steps.push(step);
      previousKind = step.kind;
    }
    days.push({ steps });
  }
  return {
    version: 1,
    generatedAt,
    queueSnapshotAt: queueCheckedAt ? Date.parse(queueCheckedAt) : null,
    profile,
    days,
  };
}

function cleanMember(member, index) {
  if (!isRecord(member)) return null;
  if (member.role !== "adult" && member.role !== "child") return null;
  const role = member.role;
  const height = finiteOr(member.height, NaN);
  const age = finiteOr(member.age, NaN);
  if (!Number.isFinite(height) || height < 50 || height > 230) return null;
  if (!Number.isFinite(age) || age < 0 || age > 110) return null;
  return {
    id: String(member.id || `${role}-${index + 1}`).slice(0, 40),
    role,
    name: String(member.name || (role === "adult" ? `Dorosły ${index + 1}` : `Dziecko ${index + 1}`)).slice(0, 40),
    height,
    age,
  };
}

function sanitizeStep(step, dayIndex, stepIndex) {
  if (!isRecord(step)) return null;
  const id = String(step.id || `day-${dayIndex + 1}-step-${stepIndex + 1}`).slice(0, 100);
  const startMin = planMinute(step.startMin);
  const endMin = planMinute(step.endMin);
  if (startMin === null || endMin === null || endMin <= startMin) return null;

  if (step.kind === "meal") {
    const restaurantId = RESTAURANT_IDS.has(step.restaurantId) ? step.restaurantId : null;
    const restaurant = restaurantId ? RESTAURANTS_BY_ID[restaurantId] : null;
    return {
      id,
      kind: "meal",
      restaurantId,
      title: String(step.title || "Przerwa na obiad").slice(0, 100),
      description: String(step.description || "").slice(0, 240),
      zone: restaurant?.zone ?? String(step.zone || "family-zone").slice(0, 40),
      startMin,
      endMin,
      walkingMinutes: Math.max(0, Math.min(180, finiteOr(step.walkingMinutes, 0))),
    };
  }

  if (step.kind === "flex") {
    const hasUnplannedUntil = step.unplannedUntil !== null && step.unplannedUntil !== undefined;
    const unplannedUntil = hasUnplannedUntil ? planMinute(step.unplannedUntil) : null;
    if (hasUnplannedUntil && (unplannedUntil === null || unplannedUntil <= endMin)) return null;

    const rawBackupIds = step.backupAttractionIds ?? [];
    if (!Array.isArray(rawBackupIds) || rawBackupIds.length > 3) return null;
    const backupAttractionIds = rawBackupIds.map((attractionId) => String(attractionId));
    if (
      new Set(backupAttractionIds).size !== backupAttractionIds.length
      || backupAttractionIds.some((attractionId) => !ALL_ATTRACTIONS_BY_ID[attractionId])
    ) return null;

    return {
      id,
      kind: "flex",
      title: String(step.title || "Bufor na prawdziwy park").slice(0, 100),
      description: String(step.description || "").slice(0, 280),
      startMin,
      endMin,
      unplannedUntil,
      backupAttractionIds,
    };
  }

  if (step.kind === "show") {
    const showId = String(step.showId || "").trim();
    const title = cleanRequiredText(step.title, 140);
    const description = cleanRequiredText(step.description, 700);
    const venue = cleanRequiredText(step.venue, 140);
    const officialUrl = officialShowUrl(step.officialUrl);
    const mapUrl = officialParkMapUrl(step.mapUrl);
    const sourceCheckedAt = validIsoTimestamp(step.sourceCheckedAt);
    const performanceStartMin = planMinute(step.performanceStartMin);
    const durationMinutes = finiteOr(step.durationMinutes, NaN);
    if (
      !/^[a-z0-9][a-z0-9-]{0,99}$/i.test(showId)
      || !title
      || !description
      || !venue
      || !officialUrl
      || !mapUrl
      || !sourceCheckedAt
      || performanceStartMin === null
      || !Number.isInteger(durationMinutes)
      || durationMinutes < 5
      || durationMinutes > 180
      || performanceStartMin < startMin
      || endMin !== performanceStartMin + durationMinutes
    ) return null;
    const performanceTimes = cleanShowTimes(step.performanceTimes ?? step.times, performanceStartMin);
    if (!performanceTimes) return null;
    const imageUrl = step.imageUrl === undefined || step.imageUrl === null ? null : officialImageUrl(step.imageUrl);
    if (step.imageUrl !== undefined && step.imageUrl !== null && !imageUrl) return null;
    return {
      id,
      kind: "show",
      showId,
      title,
      description,
      venue,
      officialUrl,
      mapUrl,
      imageUrl,
      zone: cleanRequiredText(step.zone || "", 40),
      startMin,
      performanceStartMin,
      endMin,
      durationMinutes,
      durationLabel: `${durationMinutes} min`,
      performanceTimes,
      walkingMinutes: Math.max(0, Math.min(180, finiteOr(step.walkingMinutes, 0))),
      sourceCheckedAt,
    };
  }

  if (step.kind === "ride") {
    const attraction = ALL_ATTRACTIONS_BY_ID[step.attractionId];
    if (!attraction || !Array.isArray(step.memberIds) || step.memberIds.length > MAX_MEMBERS) return null;
    return {
      id,
      kind: "ride",
      attractionId: attraction.id,
      zone: attraction.zone,
      routeOrder: finiteOr(step.routeOrder, attraction.routeOrder),
      score: finiteOr(step.score, 0),
      why: String(step.why || "").slice(0, 240),
      startMin,
      endMin,
      walkingMinutes: Math.max(0, Math.min(180, finiteOr(step.walkingMinutes, 0))),
      queueMinutes: step.queueMinutes !== null && step.queueMinutes !== undefined && Number.isFinite(finiteOr(step.queueMinutes, NaN))
        ? Math.max(0, Math.min(600, finiteOr(step.queueMinutes, 0)))
        : null,
      memberIds: step.memberIds.map(String),
    };
  }

  if (step.kind === "split") {
    if (!ALL_ATTRACTIONS_BY_ID[step.attractionId] || !ALL_ATTRACTIONS_BY_ID[step.alternativeAttractionId] || !Array.isArray(step.assignments) || step.assignments.length !== 2) return null;
    const assignments = step.assignments
      .map((assignment) => isRecord(assignment) && Array.isArray(assignment.memberIds) && assignment.memberIds.length <= MAX_MEMBERS ? ({
        label: String(assignment.label || "Podgrupa").slice(0, 60),
        attractionId: ALL_ATTRACTIONS_BY_ID[assignment.attractionId] ? assignment.attractionId : null,
        memberIds: assignment.memberIds.map(String),
      }) : null);
    if (assignments.length !== 2 || assignments.some((assignment) => !assignment?.attractionId)) return null;
    const mainAttraction = ALL_ATTRACTIONS_BY_ID[assignments[0].attractionId];
    return {
      id,
      kind: "split",
      attractionId: assignments[0].attractionId,
      alternativeAttractionId: assignments[1].attractionId,
      zone: mainAttraction.zone,
      routeOrder: finiteOr(step.routeOrder, mainAttraction.routeOrder),
      score: finiteOr(step.score, 0),
      startMin,
      endMin,
      walkingMinutes: Math.max(0, Math.min(180, finiteOr(step.walkingMinutes, 0))),
      assignments,
      reunion: {
        label: String(step.reunion?.label || "Miejsce spotkania").slice(0, 100),
        time: formatPlanTime(endMin),
      },
    };
  }
  return null;
}

export function sanitizeSharedPlan(input) {
  if (!isRecord(input) || input.version !== 1 || !isRecord(input.profile) || !Array.isArray(input.days) || input.days.length < 1 || input.days.length > 3) return null;
  if (!Array.isArray(input.profile.members) || input.profile.members.length < 1 || input.profile.members.length > MAX_MEMBERS) return null;
  const members = input.profile.members.map(cleanMember);
  if (members.some((member) => member === null) || !members.some((member) => member.role === "adult" && member.age >= 18)) return null;
  if (new Set(members.map((member) => member.id)).size !== members.length) return null;

  const arrivalTime = validTime(input.profile.arrivalTime, "10:00");
  const departureTime = validTime(input.profile.departureTime, "20:00");
  const arrival = timeToMinutes(arrivalTime, 600);
  const departure = timeToMinutes(departureTime, 1200);
  if (departure <= arrival + 59) return null;

  const requestedMealTime = validTime(input.profile.meal?.time, "13:15");
  const requestedMealMinute = timeToMinutes(requestedMealTime, 795);
  const mealTime = requestedMealMinute > arrival && requestedMealMinute < departure
    ? requestedMealTime
    : formatPlanTime(Math.round((arrival + departure) / 2));
  const profile = {
    dayCount: input.days.length,
    visitStartDate: validDateKey(input.profile.visitStartDate),
    arrivalTime,
    departureTime,
    pace: new Set(["easy", "normal", "fast"]).has(input.profile.pace) ? input.profile.pace : "normal",
    splitPolicy: new Set(["never", "worthwhile", "often"]).has(input.profile.splitPolicy) ? input.profile.splitPolicy : "never",
    preferences: {
      intensity: new Set(["calm", "mixed", "thrill"]).has(input.profile.preferences?.intensity) ? input.profile.preferences.intensity : "mixed",
      interests: Array.isArray(input.profile.preferences?.interests)
        ? [...new Set(input.profile.preferences.interests.filter((item) => VALID_INTERESTS.has(item)))].slice(0, 4)
        : [],
      wet: new Set(["avoid", "ok", "want"]).has(input.profile.preferences?.wet) ? input.profile.preferences.wet : "ok",
      maxQueue: Math.max(15, Math.min(90, finiteOr(input.profile.preferences?.maxQueue, 45))),
    },
    meal: {
      mode: new Set(["fast", "sit-down", "own", "none"]).has(input.profile.meal?.mode) ? input.profile.meal.mode : "fast",
      time: mealTime,
    },
    entertainment: {
      // Tylko literalne true włącza warstwę pokazów. Link z obcym stringiem
      // lub dawny link bez pola zawsze wraca do bezpiecznego planu bez nich.
      includeShows: input.profile.entertainment?.includeShows === true,
    },
    members,
  };

  const seenStepIds = new Set();
  const seenAttractionIds = new Set();
  let attractionCount = 0;
  const days = [];
  for (let dayIndex = 0; dayIndex < input.days.length; dayIndex += 1) {
    const day = input.days[dayIndex];
    if (!isRecord(day) || !Array.isArray(day.steps) || day.steps.length > MAX_STEPS_PER_DAY) return null;
    const steps = [];
    let mealCount = 0;
    let flexCount = 0;
    let showCount = 0;
    for (let stepIndex = 0; stepIndex < day.steps.length; stepIndex += 1) {
      const step = sanitizeStep(day.steps[stepIndex], dayIndex, stepIndex);
      // Nie pomijamy uszkodzonego kroku po cichu: zmieniłoby to znaczenie
      // udostępnionej trasy i mogłoby ukryć niebezpieczny przydział grupy.
      if (!step || seenStepIds.has(step.id)) return null;
      if (step.kind === "meal" && ++mealCount > 1) return null;
      if (step.kind === "flex") {
        if (++flexCount > 1 || stepIndex !== day.steps.length - 1) return null;
        // Starsze linki powstały po sanitizacji, która usuwała informację o
        // swobodnym odcinku dnia. Końcowy bufor zawsze oznacza horyzont do
        // zadeklarowanego wyjścia, więc możemy go bezpiecznie odtworzyć.
        if (step.unplannedUntil === null && step.endMin < departure) {
          step.unplannedUntil = departure;
        }
        if (step.unplannedUntil !== null && step.unplannedUntil !== departure) return null;
      }
      if (step.kind === "show" && (!profile.entertainment.includeShows || ++showCount > 1)) return null;
      seenStepIds.add(step.id);
      const attractionIds = step.kind === "ride"
        ? [step.attractionId]
        : step.kind === "split"
          ? step.assignments.map((assignment) => assignment.attractionId)
          : [];
      if (attractionIds.some((id) => seenAttractionIds.has(id)) || new Set(attractionIds).size !== attractionIds.length) return null;
      attractionIds.forEach((id) => seenAttractionIds.add(id));
      attractionCount += attractionIds.length;
      steps.push(step);
    }
    const coreSteps = steps.filter((step) => step.kind !== "flex");
    const finalStep = steps.at(-1);
    const horizonEnd = finalStep?.kind === "flex"
      ? finalStep.unplannedUntil ?? finalStep.endMin
      : finalStep?.endMin ?? arrival;
    // Udostępniony plan nie może po sanitizacji wyglądać na krótszy niż
    // zadeklarowana wizyta. Nowy planer zawsze domyka ten horyzont końcowym
    // krokiem lub buforem; niepełny payload odrzucamy zamiast go skracać.
    if (horizonEnd !== departure) return null;
    days.push({
      day: dayIndex + 1,
      label: `Dzień ${dayIndex + 1}`,
      steps,
      stats: {
        attractions: steps.reduce((total, step) => total + (step.kind === "split" ? 2 : step.kind === "ride" ? 1 : 0), 0),
        walkingMinutes: Math.round(steps.reduce((total, step) => total + finiteOr(step.walkingMinutes, 0), 0)),
        start: formatPlanTime(arrival),
        end: formatPlanTime(horizonEnd),
        coreEnd: formatPlanTime(coreSteps.at(-1)?.endMin ?? arrival),
        declaredDeparture: formatPlanTime(departure),
      },
    });
  }
  if (attractionCount === 0) return null;
  const plan = {
    version: 1,
    generatedAt: typeof input.generatedAt === "string" && Number.isFinite(Date.parse(input.generatedAt)) ? new Date(input.generatedAt).toISOString() : new Date().toISOString(),
    profile,
    days,
    queueSnapshotAt: Number.isFinite(finiteOr(input.queueSnapshotAt, NaN)) ? finiteOr(input.queueSnapshotAt, null) : null,
  };
  const safety = validatePlanSafety(plan);
  if (!safety.valid) return null;
  const firstAttractionId = days.flatMap((day) => day.steps)
    .find((step) => step.kind === "ride" || step.kind === "split")?.attractionId ?? null;
  return { ...plan, safety, firstAttractionId };
}

// The short-link service only accepts the compact v2 representation. Keeping
// this separate from `encodePlan` lets old, fully self-contained links remain
// readable without ever uploading a verbose legacy snapshot by accident.
export function encodeCompactPlan(plan) {
  const sanitized = sanitizeSharedPlan(plan);
  if (!sanitized) return "";

  const compactSnapshot = compactSnapshotFromPlan(sanitized);
  return compactSnapshot ? toBase64Url(JSON.stringify(compactSnapshot)) : "";
}

export function encodePlan(plan) {
  const compactPayload = encodeCompactPlan(plan);
  if (compactPayload) return compactPayload;

  const sanitized = sanitizeSharedPlan(plan);
  if (!sanitized) return "";

  // Wiek i wzrost są potrzebne do ponownej weryfikacji ograniczeń atrakcji.
  // Imiona i potencjalnie identyfikujące ID nie są — link dostaje neutralne
  // oznaczenia, a przydziały podgrup są przepinane na nowe identyfikatory.
  const roleCounts = { adult: 0, child: 0 };
  const memberIdMap = new Map();
  const members = sanitized.profile.members.map((member) => {
    roleCounts[member.role] += 1;
    const ordinal = roleCounts[member.role];
    const id = `${member.role}-${ordinal}`;
    memberIdMap.set(member.id, id);
    return {
      id,
      role: member.role,
      name: member.role === "adult" ? `Dorosły ${ordinal}` : `Dziecko ${ordinal}`,
      age: member.age,
      height: member.height,
    };
  });
  const days = sanitized.days.map((day) => ({
    steps: day.steps.map((step) => {
      if (step.kind === "ride") {
        return { ...step, memberIds: step.memberIds.map((id) => memberIdMap.get(id)) };
      }
      if (step.kind === "split") {
        return {
          ...step,
          assignments: step.assignments.map((assignment) => ({
            ...assignment,
            memberIds: assignment.memberIds.map((id) => memberIdMap.get(id)),
          })),
        };
      }
      return step;
    }),
  }));
  const snapshot = {
    version: 1,
    generatedAt: sanitized.generatedAt,
    queueSnapshotAt: sanitized.queueSnapshotAt,
    profile: { ...sanitized.profile, members },
    days,
  };
  return toBase64Url(JSON.stringify(snapshot));
}

export function decodePlan(payload) {
  try {
    if (!payload || payload.length > 24_000) return null;
    const snapshot = JSON.parse(fromBase64Url(payload));
    if (isRecord(snapshot) && snapshot.v === COMPACT_SHARE_VERSION) {
      const expanded = expandCompactSnapshot(snapshot);
      return expanded ? sanitizeSharedPlan(expanded) : null;
    }
    return sanitizeSharedPlan(snapshot);
  } catch {
    return null;
  }
}

export function planFromHash(hash = window.location.hash) {
  const match = String(hash).match(/^#plan=([^&]+)$/);
  return match ? decodePlan(match[1]) : null;
}

function currentHref(fallback = "https://example.invalid/") {
  return typeof window !== "undefined" && window.location?.href ? window.location.href : fallback;
}

export function createPlanUrl(plan, href = currentHref()) {
  const url = new URL(href);
  const payload = encodePlan(plan);
  url.hash = payload ? `plan=${payload}` : "";
  return url.toString();
}

// 16 URL-safe Base64 characters encode 96 bits: short enough to read in a
// message, still far beyond practical guessing for an opaque plan reference.
export const SHORT_PLAN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16}$/;
export const SHORTLINK_API_ENV = "VITE_SHORTLINK_API";

// Production injects this at build time. A runtime override is deliberately
// supported for local previews and makes the deployment target a one-line
// configuration change, rather than baking an account-specific Workers URL
// into the share format.
export const SHORTLINK_API_FALLBACK = "";

function configuredShortLinkApi() {
  const buildValue = typeof import.meta.env?.VITE_SHORTLINK_API === "string"
    ? import.meta.env.VITE_SHORTLINK_API
    : "";
  const runtimeValue = typeof globalThis !== "undefined" && typeof globalThis.__ENERGYLANDIA_SHORTLINK_API__ === "string"
    ? globalThis.__ENERGYLANDIA_SHORTLINK_API__
    : "";
  return buildValue || runtimeValue || SHORTLINK_API_FALLBACK;
}

export function shortLinkApiBase(apiBase = configuredShortLinkApi()) {
  const value = String(apiBase || "").trim().replace(/\/+$/, "");
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export class ShortLinkError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ShortLinkError";
    this.code = code;
  }
}

function requireShortLinkApi(apiBase) {
  const resolved = shortLinkApiBase(apiBase);
  if (!resolved) {
    throw new ShortLinkError(
      "not-configured",
      "Usługa krótkich linków nie jest teraz skonfigurowana. Spróbuj ponownie za chwilę.",
    );
  }
  return resolved;
}

function requireFetch(fetchImpl) {
  const resolved = fetchImpl ?? globalThis.fetch;
  if (typeof resolved !== "function") {
    throw new ShortLinkError("unavailable", "Ta przeglądarka nie może teraz połączyć się z usługą krótkich linków.");
  }
  return resolved;
}

async function jsonResponse(response, action) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    // The status below remains useful even when an intermediary returned HTML.
  }
  if (!response.ok) {
    const code = response.status === 404 ? "not-found" : response.status === 429 ? "rate-limited" : "request-failed";
    const fallback = action === "read"
      ? "Nie znaleźliśmy tego krótkiego planu. Link mógł wygasnąć lub być niepełny."
      : "Nie udało się utworzyć krótkiego linku. Spróbuj ponownie za chwilę.";
    throw new ShortLinkError(code, typeof body?.error === "string" ? body.error : fallback);
  }
  if (!body || typeof body !== "object") {
    throw new ShortLinkError("invalid-response", "Usługa krótkich linków zwróciła nieprawidłową odpowiedź.");
  }
  return body;
}

export function shortPlanTokenFromHash(hash = typeof window !== "undefined" ? window.location.hash : "") {
  const match = String(hash).match(/^#p\/([A-Za-z0-9_-]{16})$/);
  return match ? match[1] : null;
}

export function hasShortPlanHash(hash = typeof window !== "undefined" ? window.location.hash : "") {
  return /^#p(?:\/|$)/.test(String(hash));
}

export function createShortPlanUrl(token, href = currentHref()) {
  if (!SHORT_PLAN_TOKEN_PATTERN.test(String(token || ""))) return "";
  const url = new URL(href);
  url.hash = `p/${token}`;
  return url.toString();
}

export async function createShortPlanLink(plan, { apiBase, fetchImpl, href } = {}) {
  const payload = encodeCompactPlan(plan);
  if (!payload) {
    throw new ShortLinkError("invalid-plan", "Ten plan nie może zostać bezpiecznie zapisany jako krótki link.");
  }
  const base = requireShortLinkApi(apiBase);
  const fetcher = requireFetch(fetchImpl);
  let response;
  try {
    response = await fetcher(`${base}/plans`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ payload }),
    });
  } catch (error) {
    if (error instanceof ShortLinkError) throw error;
    throw new ShortLinkError("network", "Nie udało się połączyć z usługą krótkich linków. Sprawdź internet i spróbuj ponownie.");
  }
  const body = await jsonResponse(response, "create");
  const token = typeof body.token === "string" ? body.token : "";
  if (!SHORT_PLAN_TOKEN_PATTERN.test(token)) {
    throw new ShortLinkError("invalid-response", "Usługa krótkich linków zwróciła nieprawidłową odpowiedź.");
  }
  return createShortPlanUrl(token, href);
}

export async function loadShortPlan(token, { apiBase, fetchImpl } = {}) {
  if (!SHORT_PLAN_TOKEN_PATTERN.test(String(token || ""))) {
    throw new ShortLinkError("invalid-token", "Ten krótki link wygląda na niepełny.");
  }
  const base = requireShortLinkApi(apiBase);
  const fetcher = requireFetch(fetchImpl);
  let response;
  try {
    response = await fetcher(`${base}/plans/${encodeURIComponent(token)}`, {
      headers: { accept: "application/json" },
    });
  } catch (error) {
    if (error instanceof ShortLinkError) throw error;
    throw new ShortLinkError("network", "Nie udało się pobrać krótkiego planu. Sprawdź internet i spróbuj ponownie.");
  }
  const body = await jsonResponse(response, "read");
  const payload = typeof body.payload === "string" ? body.payload : "";
  const plan = decodePlan(payload);
  if (!plan) {
    throw new ShortLinkError("invalid-plan", "Ten krótki link nie zawiera bezpiecznego, czytelnego planu.");
  }
  return plan;
}

export function createEmailDraftUrl(email, planUrl, plan) {
  const memberById = Object.fromEntries((plan?.profile?.members ?? []).map((member) => [member.id, member.name]));
  const itinerary = (plan?.days ?? []).flatMap((day) => [
    "",
    `${day.label} (${day.stats?.start ?? ""}–${day.stats?.end ?? ""})`,
    ...(day.steps ?? []).map((step) => {
      const time = formatPlanTime(step.startMin);
      if (step.kind === "ride") return `${time} — ${ALL_ATTRACTIONS_BY_ID[step.attractionId]?.name ?? "Atrakcja"} — wszyscy`;
      if (step.kind === "meal") return `${time} — ${step.title}`;
      if (step.kind === "flex") return `${time}–${formatPlanTime(step.unplannedUntil ?? step.endMin)} — ${step.title}`;
      if (step.kind === "split") {
        const routes = step.assignments.map((assignment) => {
          const ride = ALL_ATTRACTIONS_BY_ID[assignment.attractionId]?.name ?? "Atrakcja";
          const people = assignment.memberIds.map((id) => memberById[id]).filter(Boolean).join(", ");
          return `${ride}: ${people}`;
        }).join(" | ");
        return `${time} — PODZIAŁ — ${routes} — spotkanie ${step.reunion?.time ?? ""}`;
      }
      if (step.kind === "show") {
        const performanceTime = formatPlanTime(step.performanceStartMin ?? step.startMin);
        return `${performanceTime} — POKAZ: ${step.title} (${step.durationMinutes ?? "?"} min, ${step.venue ?? "miejsce na terenie parku"})`;
      }
      return null;
    }).filter(Boolean),
  ]);
  const baseUrl = new URL(planUrl);
  baseUrl.hash = "";
  const subject = "Nasz plan Energylandii";
  const body = [
    "Cześć!",
    "",
    `Tu jest nasz plan Energylandii na ${plan?.days?.length ?? 1} ${plan?.days?.length === 1 ? "dzień" : "dni"}:`,
    ...itinerary,
    "",
    `Aplikacja: ${baseUrl.toString()}`,
    "Graficzny PDF można przygotować w aplikacji przyciskiem „Przygotuj piękny PDF” i dołączyć do tej wiadomości.",
    "",
    "Ograniczenia przy wejściu i decyzja obsługi parku zawsze mają pierwszeństwo.",
  ].filter(Boolean).join("\n");
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
