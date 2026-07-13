import { distanceMeters, walkingMinutes } from "./parkLogic.js";
import {
  ALL_ATTRACTIONS,
  ALL_ATTRACTIONS_BY_ID,
  RESTAURANTS,
  ZONES,
} from "./extendedData.js";

const DAY_ZONE_GROUPS = Object.freeze({
  1: [["sweet-valley", "aqualantis", "dragon-zone", "extreme-zone", "family-zone", "fairyland"]],
  2: [
    ["sweet-valley", "aqualantis", "dragon-zone"],
    ["extreme-zone", "family-zone", "fairyland"],
  ],
  3: [
    ["sweet-valley", "aqualantis"],
    ["dragon-zone", "extreme-zone"],
    ["family-zone", "fairyland"],
  ],
});

const PACE_MINUTES_PER_ITEM = Object.freeze({ easy: 46, normal: 40, fast: 34 });
const INTENSITY_TARGET = Object.freeze({ calm: 1, mixed: 3, thrill: 5 });
const FLEX_MINUTES_MIN = 60;
const FLEX_MINUTES_MAX = 90;
const MAX_CORE_ITEMS_PER_DAY = 12;

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTime(value, fallback) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value ?? "") ? value : fallback;
}

function normalizeDateKey(value) {
  const key = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const parsed = new Date(`${key}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === key ? key : null;
}

function validOfficialShowUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "energylandia.pl" && url.pathname.startsWith("/show/");
  } catch {
    return false;
  }
}

function validOfficialParkMapUrl(value) {
  if (value === null || value === undefined || value === "") return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "energylandia.pl" && url.pathname.startsWith("/mapa-parku/");
  } catch {
    return false;
  }
}

export function timeToMinutes(value, fallback = 600) {
  const normalized = normalizeTime(value, null);
  if (!normalized) return fallback;
  const [hour, minute] = normalized.split(":").map(Number);
  const result = hour * 60 + minute;
  return Number.isFinite(result) ? result : fallback;
}

export function formatPlanTime(minutes) {
  const safe = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function isGuardian(member) {
  return member?.role === "adult" && finiteNumber(member.age) >= 18;
}

function restrictionsFor(attraction) {
  return attraction?.restrictions ?? attraction ?? {};
}

export function evaluateMemberEligibility(attraction, member, { hasGuardian = false } = {}) {
  if (!attraction || !member) {
    return { eligible: false, mode: "unknown", reason: "Brak danych atrakcji lub uczestnika." };
  }

  const height = finiteNumber(member.height);
  const age = finiteNumber(member.age);
  if (height === null) {
    return { eligible: false, mode: "unknown-height", reason: "Brakuje wzrostu uczestnika." };
  }

  const restrictions = restrictionsFor(attraction);
  const minimumAge = finiteNumber(attraction.minAge);
  const maximumHeight = finiteNumber(restrictions.maxHeight);
  const soloHeight = finiteNumber(restrictions.soloHeight);
  const guardedHeight = finiteNumber(restrictions.minHeightWithGuardian);
  const guardedAge = finiteNumber(restrictions.minAgeWithGuardian);
  const guardedMaxAge = finiteNumber(restrictions.maxAgeWithGuardian);

  if (maximumHeight !== null && height > maximumHeight) {
    return { eligible: false, mode: "too-tall", reason: `Maksymalny wzrost to ${maximumHeight} cm.` };
  }
  if (minimumAge !== null && (age === null || age < minimumAge)) {
    return { eligible: false, mode: "too-young", reason: `Minimalny wiek to ${minimumAge} lat.` };
  }

  if (soloHeight !== null && height >= soloHeight) {
    return { eligible: true, mode: "solo", requiresGuardian: false, reason: `Może jechać od ${soloHeight} cm.` };
  }

  if (member.role === "adult" && guardedAge !== null) {
    return { eligible: true, mode: "guardian", requiresGuardian: false, reason: "Może towarzyszyć dziecku jako opiekun." };
  }

  if (guardedHeight !== null) {
    if (height < guardedHeight) {
      return {
        eligible: false,
        mode: "too-short",
        reason: `Brakuje ${Math.ceil(guardedHeight - height)} cm do minimalnego wzrostu.`,
      };
    }
    if (!hasGuardian || member.role === "adult") {
      return {
        eligible: member.role === "adult",
        mode: member.role === "adult" ? "guardian" : "guardian-required",
        requiresGuardian: member.role !== "adult",
        reason: member.role === "adult" ? "Może jechać jako opiekun." : "Potrzebny jest dorosły opiekun.",
      };
    }
    return {
      eligible: true,
      mode: "with-guardian",
      requiresGuardian: true,
      reason: `Może jechać z opiekunem od ${guardedHeight} cm.`,
    };
  }

  if (guardedAge !== null) {
    if (age === null || age < guardedAge) {
      return { eligible: false, mode: "too-young", reason: `Z opiekunem od ${guardedAge}. roku życia.` };
    }
    if (guardedMaxAge !== null && age > guardedMaxAge && member.role !== "adult") {
      return { eligible: false, mode: "age-limit", reason: `Z opiekunem do ${guardedMaxAge}. roku życia.` };
    }
    if (!hasGuardian && member.role !== "adult") {
      return { eligible: false, mode: "guardian-required", reason: "Potrzebny jest dorosły opiekun." };
    }
    return {
      eligible: true,
      mode: member.role === "adult" ? "guardian" : "with-guardian",
      requiresGuardian: member.role !== "adult",
      reason: member.role === "adult" ? "Może towarzyszyć jako opiekun." : "Może jechać z opiekunem.",
    };
  }

  return { eligible: true, mode: "unrestricted", requiresGuardian: false, reason: "Brak ograniczeń dla tego profilu." };
}

export function evaluatePartyEligibility(attraction, members) {
  const party = Array.isArray(members) ? members : [];
  const adults = party.filter(isGuardian);
  const evaluations = party.map((member) => ({
    member,
    ...evaluateMemberEligibility(attraction, member, { hasGuardian: adults.length > 0 }),
  }));
  const eligibleAdults = evaluations.filter((entry) => isGuardian(entry.member) && entry.eligible);
  const dependents = evaluations.filter((entry) => entry.member.role === "child" && entry.eligible && entry.requiresGuardian);
  const guardianShortage = dependents.length > eligibleAdults.length;

  return {
    allEligible: party.length > 0 && evaluations.every((entry) => entry.eligible) && !guardianShortage,
    guardianShortage,
    evaluations,
    eligibleMemberIds: evaluations.filter((entry) => entry.eligible).map((entry) => entry.member.id),
    ineligibleMemberIds: evaluations.filter((entry) => !entry.eligible).map((entry) => entry.member.id),
    dependentChildIds: dependents.map((entry) => entry.member.id),
    eligibleAdultIds: eligibleAdults.map((entry) => entry.member.id),
  };
}

function queueStateFor(attraction, queueById = {}) {
  const queue = queueById[attraction.id] ?? null;
  return {
    isOpen: queue?.isOpen !== false,
    waitTime: Number.isFinite(queue?.waitTime) ? queue.waitTime : null,
  };
}

function maximumQueueMinutes(profile) {
  const value = finiteNumber(profile?.preferences?.maxQueue);
  return value === null ? 45 : Math.max(0, value);
}

function respectsContentPreferences(attraction, profile) {
  if (!attraction) return false;
  if (profile?.preferences?.wet === "avoid" && attraction.wet) return false;
  if (profile?.preferences?.intensity === "calm" && (attraction.thrillLevel ?? 2) > 2) return false;
  return true;
}

function respectsHardPreferences(attraction, profile, queue) {
  if (!respectsContentPreferences(attraction, profile) || !queue?.isOpen) return false;
  return queue.waitTime === null || queue.waitTime <= maximumQueueMinutes(profile);
}

function mealDurationMinutes(profile) {
  if (profile?.meal?.mode === "none") return 0;
  if (profile?.meal?.mode === "sit-down") return 60;
  return 35;
}

function flexTargetMinutes(visitMinutes) {
  if (visitMinutes < 180) return 0;
  return Math.min(
    FLEX_MINUTES_MAX,
    Math.max(FLEX_MINUTES_MIN, Math.round((visitMinutes * 0.13) / 5) * 5),
  );
}

function capacityForProfile(profile) {
  const arrival = timeToMinutes(profile?.arrivalTime, 600);
  const requestedDeparture = timeToMinutes(profile?.departureTime, 1200);
  const departure = Math.min(1439, Math.max(arrival + 60, requestedDeparture));
  const visitMinutes = departure - arrival;
  const usableMinutes = Math.max(
    30,
    visitMinutes - mealDurationMinutes(profile) - flexTargetMinutes(visitMinutes),
  );
  const cadence = PACE_MINUTES_PER_ITEM[profile?.pace] ?? PACE_MINUTES_PER_ITEM.normal;
  return Math.min(MAX_CORE_ITEMS_PER_DAY, Math.max(1, Math.ceil(usableMinutes / cadence)));
}

function preferenceScore(attraction, profile, queue) {
  const preferences = profile.preferences ?? {};
  const target = INTENSITY_TARGET[preferences.intensity] ?? 3;
  let score = attraction.priority ?? 50;
  score -= Math.abs((attraction.thrillLevel ?? 2) - target) * 15;

  const interests = new Set(preferences.interests ?? []);
  if (interests.has("coasters") && attraction.tags.includes("coaster")) score += 34;
  if (interests.has("water") && attraction.tags.includes("water")) score += 24;
  if (interests.has("family") && (attraction.tags.includes("family") || attraction.tags.includes("calm"))) score += 22;
  if (interests.has("scenic") && (attraction.tags.includes("scenic") || attraction.tags.includes("indoor"))) score += 18;
  if (attraction.tags.includes("iconic")) score += 16;

  if (preferences.wet === "avoid" && attraction.wet) score -= 120;
  if (preferences.wet === "want" && attraction.wet) score += 34;
  if (queue.waitTime !== null) {
    score -= queue.waitTime * 1.35;
    if (queue.waitTime > (preferences.maxQueue ?? 45)) score -= 90;
  }
  return Math.round(score * 10) / 10;
}

function attractionPoint(attraction) {
  return attraction?.location ?? attraction;
}

function closestRestaurant(attraction, meal, restaurants = RESTAURANTS) {
  if (meal?.mode === "own") return null;
  const preferredKind = meal?.mode === "sit-down" ? "sit-down" : "fast";
  const matching = restaurants.filter((restaurant) => restaurant.kind === preferredKind);
  const candidates = matching.length > 0 ? matching : restaurants;
  return [...candidates].sort((a, b) =>
    distanceMeters(attractionPoint(attraction), a.location) - distanceMeters(attractionPoint(attraction), b.location),
  )[0] ?? null;
}

function membersByIds(members, ids) {
  const set = new Set(ids);
  return members.filter((member) => set.has(member.id));
}

function findSplitAlternative(mainRide, remainingMembers, candidates, queueById, profile, usedIds) {
  return candidates
    .filter((ride) => ride.id !== mainRide.id && !usedIds.has(ride.id))
    .map((ride) => {
      const eligibility = evaluatePartyEligibility(ride, remainingMembers);
      const distance = distanceMeters(mainRide, ride);
      const queue = queueStateFor(ride, queueById);
      return {
        ride,
        eligibility,
        distance,
        queue,
        score: preferenceScore(ride, profile, queue) - distance / 24,
      };
    })
    .filter((entry) =>
      entry.eligibility.allEligible
      && respectsHardPreferences(entry.ride, profile, entry.queue)
      && entry.distance <= 600,
    )
    .sort((a, b) => b.score - a.score || a.distance - b.distance)[0] ?? null;
}

function buildSplitCandidate(mainRide, profile, candidates, queueById, usedIds) {
  const members = profile.members;
  const adults = members.filter(isGuardian);
  if (profile.splitPolicy === "never" || adults.length < 2 || members.length < 3) return null;

  const mainQueue = queueStateFor(mainRide, queueById);
  if (!respectsHardPreferences(mainRide, profile, mainQueue)) return null;

  const partyEligibility = evaluatePartyEligibility(mainRide, members);
  if (partyEligibility.allEligible) return null;

  const evaluations = partyEligibility.evaluations;
  const ridingAdult = evaluations.find((entry) => isGuardian(entry.member) && entry.eligible)?.member;
  if (!ridingAdult) return null;

  const soloChildren = evaluations
    .filter((entry) => entry.member.role === "child" && entry.eligible && !entry.requiresGuardian)
    .map((entry) => entry.member);
  const dependentChild = evaluations
    .find((entry) => entry.member.role === "child" && entry.eligible && entry.requiresGuardian)?.member;
  const riders = [ridingAdult, ...soloChildren, ...(dependentChild ? [dependentChild] : [])];
  const riderIds = new Set(riders.map((member) => member.id));
  const remaining = members.filter((member) => !riderIds.has(member.id));

  if (remaining.length === 0) return null;
  if (remaining.some((member) => member.role === "child") && !remaining.some(isGuardian)) return null;

  const alternative = findSplitAlternative(mainRide, remaining, candidates, queueById, profile, usedIds);
  if (!alternative) return null;

  return {
    kind: "split",
    attractionId: mainRide.id,
    alternativeAttractionId: alternative.ride.id,
    zone: mainRide.zone,
    routeOrder: mainRide.routeOrder,
    score: preferenceScore(mainRide, profile, mainQueue) + 24,
    assignments: [
      {
        label: "Mocniejsza trasa",
        attractionId: mainRide.id,
        memberIds: riders.map((member) => member.id),
      },
      {
        label: "Trasa równoległa",
        attractionId: alternative.ride.id,
        memberIds: remaining.map((member) => member.id),
      },
    ],
    reunion: {
      label: `Spotkanie przy ${mainRide.name}`,
      location: mainRide.location,
    },
  };
}

function preferredDayForZone(zone, dayCount) {
  const groups = DAY_ZONE_GROUPS[dayCount] ?? DAY_ZONE_GROUPS[1];
  const index = groups.findIndex((zones) => zones.includes(zone));
  return index >= 0 ? index : 0;
}

function allocateToDays(items, dayCount, capacity) {
  const days = Array.from({ length: dayCount }, (_, index) => ({ index, items: [] }));
  items.forEach((item) => {
    const preferred = preferredDayForZone(item.zone, dayCount);
    const available = days
      .filter((day) => day.items.length < capacity)
      .filter((day) => day.index >= (item.availableFromDay ?? 0))
      .filter((day) => item.kind !== "split" || !day.items.some((entry) => entry.kind === "split"))
      .sort((a, b) =>
        (a.items.length - (a.index === preferred ? 2 : 0))
        - (b.items.length - (b.index === preferred ? 2 : 0))
        || a.index - b.index,
      )[0];
    if (available) available.items.push(item);
  });
  days.forEach((day) => day.items.sort((a, b) => a.routeOrder - b.routeOrder || b.score - a.score));
  return days;
}

function cautiousQueueMinutes(queue) {
  if (!Number.isFinite(queue?.waitTime)) return 25;
  return Math.max(25, Math.ceil((queue.waitTime * 1.35) / 5) * 5);
}

function rideStepDuration(ride, queue, walkMinutes) {
  return walkMinutes + cautiousQueueMinutes(queue) + (ride.durationMinutes ?? 4) + 7;
}

function queueStateForDay(attraction, queueById, dayIndex) {
  if (dayIndex > 0) return { isOpen: true, waitTime: null };
  return queueStateFor(attraction, queueById);
}

function scheduleDay(day, profile, queueById, backupAttractions = []) {
  const arrival = timeToMinutes(profile.arrivalTime, 600);
  const requestedDeparture = timeToMinutes(profile.departureTime, 1200);
  const departure = Math.min(1439, Math.max(arrival + 60, requestedDeparture));
  const visitMinutes = departure - arrival;
  const flexTarget = flexTargetMinutes(visitMinutes);
  const coreDeadline = departure - flexTarget;
  const mealTarget = timeToMinutes(profile.meal?.time, 810);
  const mealEnabled = profile.meal?.mode !== "none";
  const steps = [];
  let minute = arrival;
  let previousAttraction = null;
  let mealInserted = false;
  let walkingTotal = 0;
  const scheduledAttractionIds = new Set();
  const skippedWholeAttractions = [];

  const mealDetails = (anchor = previousAttraction) => {
    const restaurant = anchor ? closestRestaurant(anchor, profile.meal) : closestRestaurant(RESTAURANTS[0], profile.meal);
    const mealPoint = profile.meal?.mode === "own" ? anchor : restaurant;
    const walk = anchor && mealPoint ? walkingMinutes(distanceMeters(anchor, mealPoint)) : 0;
    return {
      restaurant,
      mealPoint,
      walk,
      duration: mealDurationMinutes(profile),
      total: walk + mealDurationMinutes(profile),
    };
  };

  const insertMeal = () => {
    const { restaurant, mealPoint, walk, duration, total } = mealDetails();
    if (minute + total > coreDeadline) return false;
    const mealStep = {
      id: `day-${day.index + 1}-meal`,
      kind: "meal",
      startMin: minute,
      endMin: minute + total,
      walkingMinutes: walk,
      restaurantId: restaurant?.id ?? null,
      title: profile.meal?.mode === "own" ? "Przerwa na własny prowiant" : restaurant?.name ?? "Przerwa na obiad",
      description: profile.meal?.mode === "own"
        ? "Spokojna przerwa bez szukania restauracji."
        : restaurant?.description ?? "Czas na odpoczynek i jedzenie.",
      zone: restaurant?.zone ?? previousAttraction?.zone ?? "family-zone",
    };
    steps.push(mealStep);
    minute = mealStep.endMin;
    walkingTotal += walk;
    if (mealPoint) previousAttraction = mealPoint;
    mealInserted = true;
    return true;
  };

  const describeItem = (item) => {
    if (item.kind === "split") {
      const rides = item.assignments.map((assignment) => ALL_ATTRACTIONS_BY_ID[assignment.attractionId]).filter(Boolean);
      const mainRide = rides[0];
      const alternativeRide = rides[1];
      if (!mainRide || !alternativeRide) return null;
      const walkToMain = previousAttraction ? walkingMinutes(distanceMeters(previousAttraction, mainRide)) : 0;
      const walkToAlternative = previousAttraction ? walkingMinutes(distanceMeters(previousAttraction, alternativeRide)) : 0;
      const reunionWalk = walkingMinutes(distanceMeters(alternativeRide, mainRide));
      const mainQueue = queueStateForDay(mainRide, queueById, day.index);
      const alternativeQueue = queueStateForDay(alternativeRide, queueById, day.index);
      const mainDuration = rideStepDuration(mainRide, mainQueue, walkToMain);
      const alternativeDuration = rideStepDuration(alternativeRide, alternativeQueue, walkToAlternative) + reunionWalk;
      const duration = Math.max(mainDuration, alternativeDuration, 30) + 8;
      const walk = Math.max(walkToMain, walkToAlternative + reunionWalk);
      return {
        anchor: mainRide,
        attractionIds: [mainRide.id, alternativeRide.id],
        walk,
        step: {
          ...item,
          id: `day-${day.index + 1}-split-${mainRide.id}`,
          startMin: minute,
          endMin: minute + duration,
          walkingMinutes: walk,
          queueModel: day.index === 0 ? "today-live-or-neutral" : "future-neutral",
          assignments: item.assignments.map((assignment, index) => ({
            ...assignment,
            queueMinutes: index === 0 ? mainQueue.waitTime : alternativeQueue.waitTime,
          })),
          reunion: { ...item.reunion, time: formatPlanTime(minute + duration) },
        },
      };
    }

    const ride = ALL_ATTRACTIONS_BY_ID[item.attractionId];
    if (!ride) return null;
    const walk = previousAttraction ? walkingMinutes(distanceMeters(previousAttraction, ride)) : 0;
    const queue = queueStateForDay(ride, queueById, day.index);
    const duration = rideStepDuration(ride, queue, walk);
    return {
      anchor: ride,
      attractionIds: [ride.id],
      walk,
      step: {
        ...item,
        id: `day-${day.index + 1}-ride-${ride.id}`,
        kind: "ride",
        startMin: minute,
        endMin: minute + duration,
        walkingMinutes: walk,
        queueMinutes: queue.waitTime,
        queueModel: day.index === 0 ? "today-live-or-neutral" : "future-neutral",
        why: day.index === 0
          ? item.why
          : "Pasuje całej grupie; dla kolejnego dnia nie udajemy dzisiejszej kolejki.",
        memberIds: profile.members.map((member) => member.id),
      },
    };
  };

  for (const item of day.items) {
    let described = describeItem(item);
    if (!described) continue;

    if (mealEnabled && !mealInserted) {
      const currentMeal = mealDetails();
      const latestTarget = Math.max(arrival, coreDeadline - currentMeal.total);
      const desiredStart = Math.min(Math.max(arrival, mealTarget), latestTarget);
      const afterItemMeal = mealDetails(described.anchor);
      const rideCrossesMeal = described.step.endMin > desiredStart;
      const rideLeavesNoMealRoom = described.step.endMin + afterItemMeal.total > coreDeadline;
      const beforeDeviation = Math.abs(minute - desiredStart);
      const afterDeviation = Math.abs(described.step.endMin - desiredStart);
      const mealIsCloserBeforeRide = rideCrossesMeal && beforeDeviation <= afterDeviation;
      if (minute >= desiredStart || mealIsCloserBeforeRide || rideLeavesNoMealRoom) {
        insertMeal();
        described = describeItem(item);
        if (!described) continue;
      }
    }

    if (described.step.endMin <= coreDeadline) {
      steps.push(described.step);
      minute = described.step.endMin;
      walkingTotal += described.walk;
      previousAttraction = described.anchor;
      described.attractionIds.forEach((id) => scheduledAttractionIds.add(id));
    } else if (item.kind === "ride") {
      const skipped = ALL_ATTRACTIONS_BY_ID[item.attractionId];
      if (skipped) skippedWholeAttractions.push(skipped);
    }
  }

  if (mealEnabled && !mealInserted) insertMeal();

  const coreEnd = minute;
  const eligibleBackupIds = (candidates) => candidates
    .filter((attraction) => attraction && !scheduledAttractionIds.has(attraction.id))
    .filter((attraction, index, list) => list.findIndex((entry) => entry.id === attraction.id) === index)
    .filter((attraction) => evaluatePartyEligibility(attraction, profile.members).allEligible)
    .filter((attraction) => respectsHardPreferences(
      attraction,
      profile,
      queueStateForDay(attraction, queueById, day.index),
    ))
    .map((attraction) => attraction.id);
  const unusedBackupIds = eligibleBackupIds([...skippedWholeAttractions, ...backupAttractions]);
  const repeatBackupIds = day.items
    .filter((item) => item.kind === "ride")
    .map((item) => ALL_ATTRACTIONS_BY_ID[item.attractionId])
    .filter(Boolean)
    .filter((attraction) => evaluatePartyEligibility(attraction, profile.members).allEligible)
    .filter((attraction) => respectsHardPreferences(
      attraction,
      profile,
      queueStateForDay(attraction, queueById, day.index),
    ))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .map((attraction) => attraction.id);
  const backupIds = [...new Set([...unusedBackupIds, ...repeatBackupIds])].slice(0, 3);
  const remaining = departure - minute;
  // Przy krótkiej wizycie nie rezerwujemy godzinnego bufora, ale nadal
  // domykamy oś czasu do zadeklarowanego wyjścia. Dzięki temu nawet kilka
  // pozostałych minut jest widocznym końcem planu, a nie „zaginionym”
  // fragmentem dnia.
  const minimumFlexMinutes = visitMinutes < 180 ? 1 : FLEX_MINUTES_MIN;
  if (steps.length > 0 && remaining >= minimumFlexMinutes) {
    const duration = Math.min(FLEX_MINUTES_MAX, remaining);
    const backupNames = backupIds.map((id) => ALL_ATTRACTIONS_BY_ID[id]?.name).filter(Boolean);
    const laterWindow = remaining > duration
      ? ` Po ${formatPlanTime(minute + duration)} do ${formatPlanTime(departure)} zostaje swobodne okno na dłuższe kolejki i decyzje na miejscu.`
      : "";
    const backupCopy = backupNames.length > 0
      ? ` Opcje zapasowe lub dobre powtórki: ${backupNames.join(", ")}.`
      : "";
    steps.push({
      id: `day-${day.index + 1}-flex`,
      kind: "flex",
      startMin: minute,
      endMin: minute + duration,
      title: "Bufor na prawdziwy park",
      description: `Kolejki, toalety, odpoczynek i spontaniczne decyzje — tego bloku celowo nie wypełniamy co do minuty.${backupCopy}${laterWindow}`,
      backupAttractionIds: backupIds,
      unplannedUntil: remaining > duration ? departure : null,
    });
    minute += duration;
  }

  return {
    day: day.index + 1,
    label: `Dzień ${day.index + 1}`,
    steps,
    stats: {
      attractions: steps.reduce((total, step) => total + (step.kind === "split" ? 2 : step.kind === "ride" ? 1 : 0), 0),
      walkingMinutes: walkingTotal,
      start: formatPlanTime(arrival),
      end: formatPlanTime(steps.at(-1)?.kind === "flex" && steps.at(-1)?.unplannedUntil === departure
        ? departure
        : Math.min(minute, departure)),
      coreEnd: formatPlanTime(Math.min(coreEnd, departure)),
      declaredDeparture: formatPlanTime(departure),
    },
  };
}

export function buildUniversalPlan(profile, { attractions = ALL_ATTRACTIONS, queueById = {} } = {}) {
  const members = Array.isArray(profile?.members) ? profile.members : [];
  const dayCount = Math.min(3, Math.max(1, Number(profile?.dayCount) || 1));
  const capacity = capacityForProfile(profile);
  const usedIds = new Set();
  const snapshotLooksOffHours = attractions.length > 0
    && attractions.every((attraction) => queueById?.[attraction.id]?.isOpen === false);
  // Onboarding does not ask whether this is a live, on-site visit. When the
  // whole snapshot is closed (typically outside park hours), plan neutrally
  // instead of turning an otherwise valid future visit into an empty day.
  // A mixed snapshot still keeps individual live closures authoritative.
  const effectiveQueueById = snapshotLooksOffHours ? {} : queueById;

  const ranked = attractions
    .map((attraction) => {
      const queue = queueStateFor(attraction, effectiveQueueById);
      const eligibility = evaluatePartyEligibility(attraction, members);
      const todayAllowed = respectsHardPreferences(attraction, profile, queue);
      const planningQueue = todayAllowed ? queue : { isOpen: true, waitTime: null };
      return {
        attraction,
        eligibility,
        queue,
        todayAllowed,
        score: preferenceScore(attraction, profile, planningQueue) + (eligibility.allEligible ? 58 : 0),
      };
    })
    .filter((entry) =>
      entry.todayAllowed
      || (dayCount > 1 && respectsContentPreferences(entry.attraction, profile)),
    )
    .sort((a, b) => b.score - a.score || b.attraction.priority - a.attraction.priority);

  const splitLimit = profile.splitPolicy === "often" ? dayCount : profile.splitPolicy === "worthwhile" ? 1 : 0;
  const splitItems = [];
  if (splitLimit > 0) {
    ranked
      .filter((entry) => !entry.eligibility.allEligible)
      .forEach((entry) => {
        if (splitItems.length >= splitLimit || usedIds.has(entry.attraction.id)) return;
        const split = buildSplitCandidate(entry.attraction, profile, attractions, effectiveQueueById, usedIds);
        if (!split) return;
        splitItems.push(split);
        usedIds.add(split.attractionId);
        usedIds.add(split.alternativeAttractionId);
      });
  }

  const wholeItems = ranked
    .filter((entry) => entry.eligibility.allEligible && !usedIds.has(entry.attraction.id))
    .map((entry) => ({
      kind: "ride",
      attractionId: entry.attraction.id,
      zone: entry.attraction.zone,
      routeOrder: entry.attraction.routeOrder,
      score: entry.score,
      availableFromDay: entry.todayAllowed ? 0 : 1,
      why: !entry.todayAllowed
        ? "Opcja na kolejny dzień; dzisiejszy pomiar kolejki nie jest prognozą."
        : entry.queue.waitTime === null
        ? "Pasuje całej grupie i do waszych preferencji."
        : `Pasuje całej grupie; kolejka około ${entry.queue.waitTime} min.`,
    }));

  const allocated = allocateToDays([...splitItems, ...wholeItems], dayCount, capacity);
  const allocatedIds = new Set(allocated.flatMap((day) => day.items.flatMap((item) =>
    item.kind === "split" ? [item.attractionId, item.alternativeAttractionId] : [item.attractionId],
  )));
  const backupPool = ranked
    .filter((entry) => entry.eligibility.allEligible && !allocatedIds.has(entry.attraction.id))
    .map((entry) => entry.attraction);
  const backupUsed = new Set();
  const backupByDay = allocated.map((day) => {
    const preferredZones = new Set((DAY_ZONE_GROUPS[dayCount] ?? DAY_ZONE_GROUPS[1])[day.index] ?? []);
    const options = backupPool
      .filter((attraction) => !backupUsed.has(attraction.id))
      .sort((a, b) =>
        Number(preferredZones.has(b.zone)) - Number(preferredZones.has(a.zone))
        || (b.priority ?? 0) - (a.priority ?? 0),
      )
      .slice(0, 3);
    options.forEach((attraction) => backupUsed.add(attraction.id));
    return options;
  });
  const days = allocated.map((day, index) => scheduleDay(day, profile, effectiveQueueById, backupByDay[index]));
  const plan = {
    version: 1,
    generatedAt: new Date().toISOString(),
    profile: {
      dayCount,
      visitStartDate: normalizeDateKey(profile.visitStartDate),
      arrivalTime: normalizeTime(profile.arrivalTime, "10:00"),
      departureTime: normalizeTime(profile.departureTime, "20:00"),
      pace: profile.pace,
      splitPolicy: profile.splitPolicy,
      preferences: profile.preferences,
      entertainment: { includeShows: profile?.entertainment?.includeShows === true },
      meal: profile.meal,
      members: members.map((member) => ({ ...member })),
    },
    days,
    queueSnapshotAt: profile.queueSnapshotAt ?? null,
  };
  const validation = validatePlanSafety(plan);
  return {
    ...plan,
    safety: validation,
    firstAttractionId: days.flatMap((day) => day.steps)
      .find((step) => step.kind === "ride" || step.kind === "split")?.attractionId ?? null,
  };
}

export function validatePlanSafety(plan) {
  const members = plan?.profile?.members ?? [];
  const issues = [];
  const memberIds = new Set(members.map((member) => member.id));
  const arrival = timeToMinutes(plan?.profile?.arrivalTime, 600);
  const departure = timeToMinutes(plan?.profile?.departureTime, 1200);
  const seenStepIds = new Set();
  const seenAttractionIds = new Set();
  const mealExpected = plan?.profile?.meal?.mode !== "none";
  let totalSplitCount = 0;

  if (members.length === 0) issues.push("Plan wymaga co najmniej jednego uczestnika.");
  if (memberIds.size !== members.length) issues.push("Uczestnicy muszą mieć unikalne identyfikatory.");
  if (members.some((member) => typeof member.id !== "string" || member.id.trim() === "")) {
    issues.push("Każdy uczestnik musi mieć niepusty identyfikator.");
  }
  if (members.some((member) => member.role === "child") && !members.some(isGuardian)) {
    issues.push("W planie z dzieckiem musi być co najmniej jeden dorosły opiekun.");
  }
  if (departure <= arrival || departure - arrival < 60) {
    issues.push("Godziny wizyty muszą tworzyć co najmniej godzinne, rosnące okno.");
  }

  for (const [dayIndex, day] of (plan?.days ?? []).entries()) {
    let previousEnd = arrival;
    let mealCount = 0;
    let splitCount = 0;
    let flexCount = 0;
    let showCount = 0;
    for (const step of day.steps ?? []) {
      if (typeof step.id !== "string" || step.id.trim() === "" || seenStepIds.has(step.id)) {
        issues.push(`${day.label}: kroki muszą mieć unikalne, niepuste identyfikatory.`);
      } else {
        seenStepIds.add(step.id);
      }
      if (!Number.isFinite(step.startMin) || !Number.isFinite(step.endMin) || step.endMin <= step.startMin) {
        issues.push(`${day.label}: nieprawidłowe godziny kroku.`);
        continue;
      }
      if (step.startMin < arrival || step.endMin > departure || step.startMin < previousEnd) {
        issues.push(`${day.label}: kroki wychodzą poza wizytę albo nakładają się.`);
      }
      previousEnd = step.endMin;
      if (step.kind === "ride") {
        const ride = ALL_ATTRACTIONS_BY_ID[step.attractionId];
        if (seenAttractionIds.has(step.attractionId)) {
          issues.push(`${day.label}: atrakcja występuje w planie więcej niż raz.`);
        } else {
          seenAttractionIds.add(step.attractionId);
        }
        const stepMemberIds = Array.isArray(step.memberIds) ? step.memberIds : [];
        const uniqueStepIds = new Set(stepMemberIds);
        const coversEveryone = uniqueStepIds.size === memberIds.size
          && stepMemberIds.length === memberIds.size
          && [...memberIds].every((id) => uniqueStepIds.has(id));
        const stepMembers = membersByIds(members, stepMemberIds);
        if (!coversEveryone) issues.push(`${day.label}: krok „wszyscy” nie obejmuje całej grupy.`);
        if (!ride || !evaluatePartyEligibility(ride, stepMembers).allEligible) {
          issues.push(`${day.label}: nieprawidłowa grupa przy ${ride?.name ?? step.attractionId}.`);
        }
        if (ride && plan?.profile?.preferences?.wet === "avoid" && ride.wet) {
          issues.push(`${day.label}: mokra atrakcja łamie preferencję „bez wody”.`);
        }
        if (ride && plan?.profile?.preferences?.intensity === "calm" && (ride.thrillLevel ?? 2) > 2) {
          issues.push(`${day.label}: mocna atrakcja łamie spokojny tryb.`);
        }
        if (Number.isFinite(step.queueMinutes) && step.queueMinutes > maximumQueueMinutes(plan.profile)) {
          issues.push(`${day.label}: kolejka przekracza zadeklarowany limit.`);
        }
        if (dayIndex > 0 && Number.isFinite(step.queueMinutes)) {
          issues.push(`${day.label}: przyszły dzień nie może udawać dzisiejszego pomiaru kolejki.`);
        }
      }
      if (step.kind === "split") {
        splitCount += 1;
        totalSplitCount += 1;
        if (plan?.profile?.splitPolicy === "never") {
          issues.push(`${day.label}: plan bez podziałów nie może zawierać rozdzielenia grupy.`);
        }
        if (!Array.isArray(step.assignments) || step.assignments.length !== 2) {
          issues.push(`${day.label}: podział musi mieć dokładnie dwie podgrupy.`);
        }
        const seen = new Set();
        for (const assignment of step.assignments ?? []) {
          const ride = ALL_ATTRACTIONS_BY_ID[assignment.attractionId];
          if (seenAttractionIds.has(assignment.attractionId)) {
            issues.push(`${day.label}: atrakcja występuje w planie więcej niż raz.`);
          } else {
            seenAttractionIds.add(assignment.attractionId);
          }
          const assignedMembers = membersByIds(members, assignment.memberIds ?? []);
          if (!ride || !evaluatePartyEligibility(ride, assignedMembers).allEligible) {
            issues.push(`${day.label}: niebezpieczny podział przy ${ride?.name ?? assignment.attractionId}.`);
          }
          for (const id of assignment.memberIds ?? []) {
            if (!memberIds.has(id) || seen.has(id)) issues.push(`${day.label}: uczestnik jest przypisany nieprawidłowo.`);
            seen.add(id);
          }
          if (assignedMembers.some((member) => member.role === "child") && !assignedMembers.some(isGuardian)) {
            issues.push(`${day.label}: dziecko bez dorosłego w podgrupie.`);
          }
          if (ride && plan?.profile?.preferences?.wet === "avoid" && ride.wet) {
            issues.push(`${day.label}: mokra atrakcja łamie preferencję „bez wody”.`);
          }
          if (ride && plan?.profile?.preferences?.intensity === "calm" && (ride.thrillLevel ?? 2) > 2) {
            issues.push(`${day.label}: mocna atrakcja łamie spokojny tryb.`);
          }
          if (Number.isFinite(assignment.queueMinutes) && assignment.queueMinutes > maximumQueueMinutes(plan.profile)) {
            issues.push(`${day.label}: kolejka w podziale przekracza zadeklarowany limit.`);
          }
          if (dayIndex > 0 && Number.isFinite(assignment.queueMinutes)) {
            issues.push(`${day.label}: przyszły dzień nie może udawać dzisiejszego pomiaru kolejki.`);
          }
        }
        if (seen.size !== memberIds.size || [...memberIds].some((id) => !seen.has(id))) {
          issues.push(`${day.label}: podział nie obejmuje całej grupy.`);
        }
        if (!step.reunion?.time) issues.push(`${day.label}: podział bez czasu spotkania.`);
      }
      if (step.kind === "meal") mealCount += 1;
      if (step.kind === "show") {
        showCount += 1;
        const performanceStart = Number(step.performanceStartMin);
        const duration = Number(step.durationMinutes);
        if (plan?.profile?.entertainment?.includeShows !== true) {
          issues.push(`${day.label}: pokaz może znaleźć się w planie tylko po wyraźnym wyborze tej opcji.`);
        }
        if (
          typeof step.showId !== "string" || step.showId.trim() === ""
          || typeof step.title !== "string" || step.title.trim() === ""
          || typeof step.venue !== "string" || step.venue.trim() === ""
          || !validOfficialShowUrl(step.officialUrl)
          || !validOfficialParkMapUrl(step.mapUrl)
        ) {
          issues.push(`${day.label}: pokaz nie ma kompletnego, oficjalnego źródła.`);
        }
        if (
          !Number.isInteger(performanceStart)
          || !Number.isInteger(duration)
          || duration < 5
          || duration > 120
          || performanceStart < step.startMin
          || performanceStart >= step.endMin
          || step.endMin !== performanceStart + duration
        ) {
          issues.push(`${day.label}: pokaz ma nieprawidłową godzinę lub długość.`);
        }
        if (!Number.isFinite(Date.parse(step.sourceCheckedAt || ""))) {
          issues.push(`${day.label}: pokaz musi ujawniać czas sprawdzenia oficjalnego terminarza.`);
        }
      }
      if (step.kind === "flex") {
        flexCount += 1;
        const duration = step.endMin - step.startMin;
        const minimumFlexMinutes = departure - arrival < 180 ? 1 : FLEX_MINUTES_MIN;
        if (duration < minimumFlexMinutes || duration > FLEX_MINUTES_MAX) {
          issues.push(departure - arrival < 180
            ? `${day.label}: bufor krótkiej wizyty musi mieć od 1 do 90 minut.`
            : `${day.label}: bufor musi mieć od 60 do 90 minut.`);
        }
        const hasUnplannedUntil = step.unplannedUntil !== null && step.unplannedUntil !== undefined;
        if (hasUnplannedUntil && (
          !Number.isInteger(step.unplannedUntil)
          || step.unplannedUntil <= step.endMin
          || step.unplannedUntil !== departure
        )) {
          issues.push(`${day.label}: swobodne okno bufora musi kończyć się o zadeklarowanej porze wyjścia.`);
        }
        if (step.endMin < departure && !hasUnplannedUntil) {
          issues.push(`${day.label}: bufor nie obejmuje reszty zadeklarowanego dnia.`);
        }
        if (
          !Array.isArray(step.backupAttractionIds)
          || step.backupAttractionIds.length > 3
          || new Set(step.backupAttractionIds).size !== step.backupAttractionIds.length
          || step.backupAttractionIds.some((id) => !ALL_ATTRACTIONS_BY_ID[id])
        ) {
          issues.push(`${day.label}: bufor ma nieprawidłowe atrakcje zapasowe.`);
        }
      }
      if (!new Set(["ride", "split", "meal", "show", "flex"]).has(step.kind)) {
        issues.push(`${day.label}: nieznany rodzaj kroku.`);
      }
    }
    if (mealExpected && mealCount !== 1) issues.push(`${day.label}: zaplanowany posiłek musi być jednym twardym blokiem.`);
    if (!mealExpected && mealCount !== 0) issues.push(`${day.label}: plan bez posiłku nie może zawierać bloku obiadu.`);
    if (splitCount > 1) issues.push(`${day.label}: najwyżej jeden podział grupy na dzień.`);
    if (showCount > 1) issues.push(`${day.label}: najwyżej jeden pokaz może wejść do planu dnia.`);
    if (flexCount > 1) issues.push(`${day.label}: najwyżej jeden kontrolowany bufor na dzień.`);
    const finalStep = day.steps?.at(-1);
    const horizonEnd = finalStep?.kind === "flex"
      ? finalStep.unplannedUntil ?? finalStep.endMin
      : finalStep?.endMin;
    if (horizonEnd !== departure) {
      issues.push(`${day.label}: plan nie obejmuje całego okna aż do zadeklarowanego wyjścia.`);
    }
  }
  if (plan?.profile?.splitPolicy === "worthwhile" && totalSplitCount > 1) {
    issues.push("Tryb „tylko gdy warto” pozwala najwyżej na jeden podział w całym planie.");
  }
  return { valid: issues.length === 0, issues };
}

export function attractionLabel(attraction) {
  if (!attraction) return "Atrakcja";
  const restrictions = restrictionsFor(attraction);
  const guarded = finiteNumber(restrictions.minHeightWithGuardian);
  const guardedAge = finiteNumber(restrictions.minAgeWithGuardian);
  const guardedMaxAge = finiteNumber(restrictions.maxAgeWithGuardian);
  const solo = finiteNumber(restrictions.soloHeight);
  const max = finiteNumber(restrictions.maxHeight);
  if (guarded !== null && solo !== null && guarded < solo) return `${guarded} cm z opiekunem · ${solo} cm samodzielnie`;
  if (guardedAge !== null) {
    const ageAccess = guardedAge === 0
      ? "bez limitu wieku z opiekunem"
      : guardedMaxAge !== null
        ? `${guardedAge}–${guardedMaxAge} lat z opiekunem`
        : `od ${guardedAge} lat z opiekunem`;
    return solo !== null ? `${ageAccess} · ${solo} cm samodzielnie` : ageAccess;
  }
  if (solo !== null && max !== null) return `${solo}–${max} cm`;
  if (solo !== null) return `od ${solo} cm`;
  return "sprawdź ograniczenia";
}

export function zoneLabel(zone) {
  return ZONES[zone]?.name ?? "Energylandia";
}
