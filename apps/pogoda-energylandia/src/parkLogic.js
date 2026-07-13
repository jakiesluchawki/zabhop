import { ATTRACTIONS, DEFAULT_ZONE_ORDER, TOILETS } from "./parkData.js";

export const WALKING_METERS_PER_MINUTE = 65;

export const FAMILY_PROFILE = Object.freeze({
  adults: 2,
  children: 2,
  childAge: 6,
  withGuardian: true,
  safeHeightCm: 120,
  heightRange: Object.freeze({ min: 120, max: 129 }),
  heightRangeLabel: "120–129 cm",
  description: "2 dorosłych · 2 dzieci po 6 lat · 120–129 cm",
});

const CLOSED_STATUSES = new Set([
  "closed",
  "down",
  "maintenance",
  "paused",
  "temporarilyclosed",
  "unavailable",
  "zamkniete",
  "zamknieta",
  "nieczynne",
  "nieczynna",
  "awaria",
]);

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9]+/g, "");
}

function readPosition(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const lat = finiteNumber(value[0]);
    const lon = finiteNumber(value[1]);
    return lat === null || lon === null ? null : { lat, lon };
  }

  if (!value || typeof value !== "object") return null;
  if (value.location && value.location !== value) return readPosition(value.location);
  if (value.position && value.position !== value) return readPosition(value.position);
  if (value.coords && value.coords !== value) return readPosition(value.coords);

  const lat = finiteNumber(value.lat ?? value.latitude);
  const lon = finiteNumber(value.lon ?? value.lng ?? value.longitude);
  return lat === null || lon === null ? null : { lat, lon };
}

export function distanceMeters(a, b) {
  const start = readPosition(a);
  const end = readPosition(b);
  if (!start || !end) throw new TypeError("Pozycja musi zawierać liczbowe lat oraz lon/lng.");

  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(end.lat - start.lat);
  const longitudeDelta = toRadians(end.lon - start.lon);
  const startLatitude = toRadians(start.lat);
  const endLatitude = toRadians(end.lat);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function walkingMinutes(meters, metersPerMinute = WALKING_METERS_PER_MINUTE) {
  const distance = finiteNumber(meters);
  const speed = finiteNumber(metersPerMinute);
  if (distance === null || distance < 0 || speed === null || speed <= 0) {
    throw new TypeError("Dystans i tempo marszu muszą być dodatnimi liczbami.");
  }
  if (distance === 0) return 0;
  return Math.max(1, Math.ceil(distance / speed));
}

function restrictionsFor(attraction) {
  return attraction?.restrictions ?? attraction ?? {};
}

export function evaluateEligibility(attraction, { height, age = 6, withGuardian = true } = {}) {
  if (!attraction || typeof attraction !== "object") {
    return { eligible: false, mode: "unknown-attraction", reason: "Nieznana atrakcja." };
  }
  const childHeight = finiteNumber(height);
  const childAge = finiteNumber(age);
  const restrictions = restrictionsFor(attraction);
  const minHeightWithGuardian = finiteNumber(restrictions.minHeightWithGuardian);
  const minAgeWithGuardian = finiteNumber(restrictions.minAgeWithGuardian);
  const maxAgeWithGuardian = finiteNumber(restrictions.maxAgeWithGuardian);
  const soloHeight = finiteNumber(restrictions.soloHeight);
  const maxHeight = finiteNumber(restrictions.maxHeight);

  if (childHeight === null) {
    return { eligible: false, mode: "unknown-height", reason: "Podaj wzrost dziecka." };
  }
  if (maxHeight !== null && childHeight > maxHeight) {
    return {
      eligible: false,
      mode: "too-tall",
      reason: `Maksymalny wzrost to ${maxHeight} cm.`,
    };
  }
  if (soloHeight !== null && childHeight >= soloHeight) {
    return {
      eligible: true,
      mode: "solo",
      reason: `Może jechać samodzielnie od ${soloHeight} cm.`,
    };
  }
  if (!withGuardian) {
    return {
      eligible: false,
      mode: "guardian-required",
      reason: soloHeight === null
        ? "Ta atrakcja wymaga opiekuna."
        : `Bez opiekuna dopiero od ${soloHeight} cm.`,
    };
  }

  if (minHeightWithGuardian !== null) {
    if (childHeight >= minHeightWithGuardian) {
      return {
        eligible: true,
        mode: "with-guardian",
        reason: `Może jechać z opiekunem od ${minHeightWithGuardian} cm.`,
      };
    }
    return {
      eligible: false,
      mode: "too-short",
      missingHeight: minHeightWithGuardian - childHeight,
      reason: `Brakuje ${Math.ceil(minHeightWithGuardian - childHeight)} cm do jazdy z opiekunem.`,
    };
  }

  if (minAgeWithGuardian !== null) {
    if (childAge === null) {
      return { eligible: false, mode: "unknown-age", reason: "Podaj wiek dziecka." };
    }
    if (childAge < minAgeWithGuardian) {
      return {
        eligible: false,
        mode: "too-young",
        reason: `Z opiekunem od ${minAgeWithGuardian}. roku życia.`,
      };
    }
    if (maxAgeWithGuardian !== null && childAge > maxAgeWithGuardian) {
      return {
        eligible: false,
        mode: "too-old-for-guardian-rule",
        reason: `Z opiekunem do ${maxAgeWithGuardian}. roku życia.`,
      };
    }
    return {
      eligible: true,
      mode: "with-guardian",
      reason: `Może jechać z opiekunem od ${minAgeWithGuardian}. roku życia.`,
    };
  }

  return { eligible: true, mode: "unrestricted", reason: "Brak ograniczeń dla tego profilu." };
}

export function classifyAttractionForFamily(attraction) {
  if (!attraction || typeof attraction !== "object" || attraction.toddlerLike) {
    return "excluded";
  }

  const restrictions = restrictionsFor(attraction);
  const minHeightWithGuardian = finiteNumber(restrictions.minHeightWithGuardian);
  const minAgeWithGuardian = finiteNumber(restrictions.minAgeWithGuardian);

  // A 140 cm solo threshold is fine when the children may ride with a guardian
  // from 120 cm. We only exclude rides whose guarded minimum itself is 140+.
  if (minHeightWithGuardian !== null && minHeightWithGuardian >= 140) {
    return "excluded";
  }

  const eligibility = evaluateEligibility(attraction, {
    height: FAMILY_PROFILE.safeHeightCm,
    age: FAMILY_PROFILE.childAge,
    withGuardian: FAMILY_PROFILE.withGuardian,
  });
  if (!eligibility.eligible) return "excluded";

  if (minHeightWithGuardian === FAMILY_PROFILE.safeHeightCm) return "primary";
  if (minHeightWithGuardian === 100 || minHeightWithGuardian === 110) return "secondary";
  if (minHeightWithGuardian === null && minAgeWithGuardian !== null) return "secondary";

  // Keep the private shortlist intentionally strict. Unknown or unusual
  // thresholds must be reviewed before they can enter the yellow fallback.
  return "excluded";
}

export function getEligibleAttractions({
  height,
  age = 6,
  withGuardian = true,
  attractions = ATTRACTIONS,
} = {}) {
  return attractions.flatMap((attraction) => {
    const eligibility = evaluateEligibility(attraction, { height, age, withGuardian });
    return eligibility.eligible ? [{ ...attraction, eligibility }] : [];
  });
}

function aliasesFor(attraction) {
  return [attraction.id, attraction.name, ...(attraction.queueAliases ?? [])]
    .map(normalizeName)
    .filter(Boolean);
}

function lookupByAliases(values, attraction) {
  if (!values || typeof values !== "object") return undefined;
  if (values instanceof Map) {
    for (const [key, value] of values) {
      if (aliasesFor(attraction).includes(normalizeName(key))) return value;
    }
    return undefined;
  }
  for (const alias of aliasesFor(attraction)) {
    const key = Object.keys(values).find((candidate) => normalizeName(candidate) === alias);
    if (key !== undefined) return values[key];
  }
  return undefined;
}

function normalizeStatus(value) {
  const status = normalizeName(value || "open");
  return status || "open";
}

function queueMinutesFrom(entry) {
  if (typeof entry === "number" || typeof entry === "string") {
    const value = finiteNumber(entry);
    return value === null ? null : Math.max(0, value);
  }
  if (!entry || typeof entry !== "object") return null;
  const value = finiteNumber(
    entry.minutes ??
      entry.waitMinutes ??
      entry.waitingMinutes ??
      entry.queueMinutes ??
      entry.wait_time ??
      entry.waiting_time ??
      entry.queue_time ??
      entry.wait ??
      entry.queue,
  );
  return value === null ? null : Math.max(0, value);
}

export function resolveAttractionState(attraction, { queueById = {}, statusById = {} } = {}) {
  const queueEntry = lookupByAliases(queueById, attraction);
  const statusEntry = lookupByAliases(statusById, attraction);
  const statusValue =
    (statusEntry && typeof statusEntry === "object" ? statusEntry.status : statusEntry) ??
    (queueEntry && typeof queueEntry === "object" ? queueEntry.status : undefined) ??
    (typeof queueEntry === "string" && finiteNumber(queueEntry) === null ? queueEntry : undefined) ??
    (queueEntry && typeof queueEntry === "object" && queueEntry.open === false ? "closed" : undefined) ??
    attraction.defaultStatus ??
    "open";
  const normalizedStatus = normalizeStatus(statusValue);

  return {
    status: String(statusValue || "open"),
    normalizedStatus,
    isAvailable: !CLOSED_STATUSES.has(normalizedStatus),
    queueMinutes: queueMinutesFrom(queueEntry),
  };
}

function valuesFromIdCollection(values) {
  if (values === null || values === undefined) return [];
  if (typeof values === "string" || typeof values === "number") return [values];
  if (typeof values[Symbol.iterator] === "function") return [...values];
  return [];
}

function normalizedIdSet(...collections) {
  return new Set(
    collections
      .flatMap(valuesFromIdCollection)
      .map(normalizeName)
      .filter(Boolean),
  );
}

function completedSet(completedIds) {
  return normalizedIdSet(completedIds);
}

function isCompleted(attraction, completed) {
  return aliasesFor(attraction).some((alias) => completed.has(alias));
}

function orderedZones(startZone) {
  if (startZone === "aqualantis") {
    return ["aqualantis", "sweet-valley", "dragon-zone", "extreme-zone", "family-zone", "fairyland"];
  }
  return [...DEFAULT_ZONE_ORDER];
}

function inferStartZone(position) {
  if (!readPosition(position)) return "sweet-valley";
  const candidates = ATTRACTIONS.filter((item) =>
    item.zone === "sweet-valley" || item.zone === "aqualantis",
  );
  const nearest = candidates.reduce((best, item) => {
    const distance = distanceMeters(position, item);
    return !best || distance < best.distance ? { zone: item.zone, distance } : best;
  }, null);
  return nearest?.zone ?? "sweet-valley";
}

export function buildRoute({
  height = FAMILY_PROFILE.safeHeightCm,
  age = FAMILY_PROFILE.childAge,
  withGuardian = FAMILY_PROFILE.withGuardian,
  completedIds = [],
  position = null,
  startZone,
  queueById = {},
  statusById = {},
  attractions = ATTRACTIONS,
} = {}) {
  const completed = completedSet(completedIds);
  const zoneOrder = orderedZones(startZone ?? inferStartZone(position));
  const zoneRank = new Map(zoneOrder.map((zone, index) => [zone, index]));
  const eligible = getEligibleAttractions({ height, age, withGuardian, attractions })
    .map((item) => ({ ...item, familyTier: classifyAttractionForFamily(item) }))
    .filter((item) => item.familyTier !== "excluded")
    .filter((item) => !isCompleted(item, completed))
    .map((item) => ({ ...item, live: resolveAttractionState(item, { queueById, statusById }) }))
    .filter((item) => item.live.isAvailable)
    .sort((a, b) =>
      (zoneRank.get(a.zone) ?? 99) - (zoneRank.get(b.zone) ?? 99) ||
      a.routeOrder - b.routeOrder ||
      b.priority - a.priority,
    );

  let previous = readPosition(position) ? position : null;
  return eligible.map((item, routeIndex) => {
    const legDistance = previous ? distanceMeters(previous, item) : 0;
    const stop = {
      ...item,
      routeIndex,
      status: item.live.status,
      queueMinutes: item.live.queueMinutes,
      distanceFromPreviousMeters: Math.round(legDistance),
      walkingMinutesFromPrevious: walkingMinutes(legDistance),
    };
    delete stop.live;
    previous = item;
    return stop;
  });
}

/**
 * Returns every safe next-stop candidate in deterministic recommendation order.
 *
 * `excludedIds` is deliberately separate from `completedIds`: callers can add a
 * suggestion to it when someone taps "Pokaż inną", then clear it to start a new
 * recommendation pass without changing completed history. `skippedIds` and
 * `excludedSuggestionIds` are accepted aliases so persisted UI state can be
 * migrated without changing the ranking semantics.
 */
export function rankNextStops({
  position,
  height = FAMILY_PROFILE.safeHeightCm,
  age = FAMILY_PROFILE.childAge,
  withGuardian = FAMILY_PROFILE.withGuardian,
  completedIds = [],
  excludedIds = [],
  skippedIds = [],
  excludedSuggestionIds = [],
  queueById = {},
  statusById = {},
  attractions = ATTRACTIONS,
} = {}) {
  const currentPosition = readPosition(position);
  if (!currentPosition) return [];
  const completed = completedSet(completedIds);
  const excluded = normalizedIdSet(excludedIds, skippedIds, excludedSuggestionIds);

  return getEligibleAttractions({ height, age, withGuardian, attractions })
    .map((item) => ({ ...item, familyTier: classifyAttractionForFamily(item) }))
    .filter((item) => item.familyTier !== "excluded")
    .filter((item) => !isCompleted(item, completed))
    .filter((item) => !isCompleted(item, excluded))
    .map((item) => {
      const live = resolveAttractionState(item, { queueById, statusById });
      const distance = distanceMeters(currentPosition, item);
      const walk = walkingMinutes(distance);
      const queue = live.queueMinutes ?? 12;
      const familyTierBoost = item.familyTier === "primary" ? 500 : 0;
      const score = familyTierBoost + item.priority - queue * 1.8 - walk * 2;
      return { item, live, distance, walk, score };
    })
    .filter((candidate) => candidate.live.isAvailable)
    .sort((a, b) =>
      b.score - a.score ||
      a.distance - b.distance ||
      a.item.routeOrder - b.item.routeOrder ||
      a.item.id.localeCompare(b.item.id, "pl"),
    )
    .map((candidate) => ({
      ...candidate.item,
      status: candidate.live.status,
      queueMinutes: candidate.live.queueMinutes,
      distanceMeters: Math.round(candidate.distance),
      walkingMinutes: candidate.walk,
      score: Math.round(candidate.score * 10) / 10,
      reason: candidate.live.queueMinutes === null
        ? `${candidate.walk} min pieszo; brak pewnego czasu kolejki.`
        : `${candidate.walk} min pieszo i ok. ${Math.round(candidate.live.queueMinutes)} min kolejki.`,
    }));
}

export function chooseNextStop(options = {}) {
  return rankNextStops(options)[0] ?? null;
}

export function findNearestToilet(position, toilets = TOILETS) {
  if (!readPosition(position) || !Array.isArray(toilets) || toilets.length === 0) return null;
  const nearest = toilets
    .map((toilet) => ({ toilet, distance: distanceMeters(position, toilet) }))
    .sort((a, b) => a.distance - b.distance)[0];

  return {
    ...nearest.toilet,
    distanceMeters: Math.round(nearest.distance),
    walkingMinutes: walkingMinutes(nearest.distance),
  };
}
