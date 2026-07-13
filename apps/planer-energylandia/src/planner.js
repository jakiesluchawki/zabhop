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

const PACE_CAPACITY = Object.freeze({ easy: 6, normal: 8, fast: 10 });
const INTENSITY_TARGET = Object.freeze({ calm: 1, mixed: 3, thrill: 5 });

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTime(value, fallback) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value ?? "") ? value : fallback;
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
    .filter((entry) => entry.eligibility.allEligible && entry.queue.isOpen && entry.distance <= 600)
    .sort((a, b) => b.score - a.score || a.distance - b.distance)[0] ?? null;
}

function buildSplitCandidate(mainRide, profile, candidates, queueById, usedIds) {
  const members = profile.members;
  const adults = members.filter(isGuardian);
  if (profile.splitPolicy === "never" || adults.length < 2 || members.length < 3) return null;

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

  const mainQueue = queueStateFor(mainRide, queueById);
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
      .sort((a, b) =>
        (a.index === preferred ? -1 : 0) - (b.index === preferred ? -1 : 0) ||
        a.items.length - b.items.length,
      )[0];
    (available ?? days.sort((a, b) => a.items.length - b.items.length)[0]).items.push(item);
  });
  days.forEach((day) => day.items.sort((a, b) => a.routeOrder - b.routeOrder || b.score - a.score));
  return days;
}

function cautiousQueueMinutes(queue) {
  if (!Number.isFinite(queue?.waitTime)) return 15;
  if (queue.waitTime === 0) return 5;
  return Math.ceil((queue.waitTime * 1.35) / 5) * 5;
}

function rideStepDuration(ride, queue, walkMinutes) {
  return walkMinutes + cautiousQueueMinutes(queue) + (ride.durationMinutes ?? 4) + 7;
}

function scheduleDay(day, profile, queueById) {
  const arrival = timeToMinutes(profile.arrivalTime, 600);
  const requestedDeparture = timeToMinutes(profile.departureTime, 1200);
  const departure = Math.min(1439, Math.max(arrival + 60, requestedDeparture));
  const mealTarget = timeToMinutes(profile.meal?.time, 810);
  const mealEnabled = profile.meal?.mode !== "none";
  const mealInsertIndex = mealEnabled
    ? Math.min(Math.max(2, Math.round((mealTarget - arrival) / 42)), Math.max(2, day.items.length - 1))
    : -1;
  const steps = [];
  let minute = arrival;
  let previousAttraction = null;
  let mealInserted = false;
  let walkingTotal = 0;

  const insertMeal = () => {
    const anchor = previousAttraction ?? ALL_ATTRACTIONS_BY_ID[day.items[0]?.attractionId];
    const restaurant = anchor ? closestRestaurant(anchor, profile.meal) : RESTAURANTS[0];
    const duration = profile.meal?.mode === "sit-down" ? 60 : profile.meal?.mode === "own" ? 35 : 35;
    const mealPoint = profile.meal?.mode === "own" ? anchor : restaurant;
    const walk = previousAttraction && mealPoint
      ? walkingMinutes(distanceMeters(previousAttraction, mealPoint))
      : 0;
    const earliestStart = Math.max(minute, mealTarget - 20);
    const start = Math.min(earliestStart, departure - duration - walk);
    if (start < minute || start + walk + duration > departure) {
      mealInserted = true;
      return false;
    }
    const mealStep = {
      id: `day-${day.index + 1}-meal`,
      kind: "meal",
      startMin: start,
      endMin: start + walk + duration,
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

  day.items.forEach((item, itemIndex) => {
    if (mealEnabled && !mealInserted && itemIndex === mealInsertIndex) insertMeal();

    if (item.kind === "split") {
      const rides = item.assignments.map((assignment) => ALL_ATTRACTIONS_BY_ID[assignment.attractionId]).filter(Boolean);
      const mainRide = rides[0];
      const alternativeRide = rides[1];
      if (!mainRide || !alternativeRide) return;
      const walkToMain = previousAttraction ? walkingMinutes(distanceMeters(previousAttraction, mainRide)) : 0;
      const walkToAlternative = previousAttraction ? walkingMinutes(distanceMeters(previousAttraction, alternativeRide)) : 0;
      const reunionWalk = walkingMinutes(distanceMeters(alternativeRide, mainRide));
      const mainDuration = rideStepDuration(mainRide, queueStateFor(mainRide, queueById), walkToMain);
      const alternativeDuration = rideStepDuration(alternativeRide, queueStateFor(alternativeRide, queueById), walkToAlternative) + reunionWalk;
      const duration = Math.max(mainDuration, alternativeDuration, 30) + 8;
      const walk = Math.max(walkToMain, walkToAlternative + reunionWalk);
      const step = {
        ...item,
        id: `day-${day.index + 1}-split-${mainRide.id}`,
        startMin: minute,
        endMin: minute + duration,
        walkingMinutes: walk,
        reunion: { ...item.reunion, time: formatPlanTime(minute + duration) },
      };
      if (step.endMin <= departure) {
        steps.push(step);
        minute = step.endMin;
        walkingTotal += walk;
        previousAttraction = mainRide;
      }
      return;
    }

    const ride = ALL_ATTRACTIONS_BY_ID[item.attractionId];
    if (!ride) return;
    const walk = previousAttraction ? walkingMinutes(distanceMeters(previousAttraction, ride)) : 0;
    const queue = queueStateFor(ride, queueById);
    const duration = rideStepDuration(ride, queue, walk);
    const step = {
      ...item,
      id: `day-${day.index + 1}-ride-${ride.id}`,
      kind: "ride",
      startMin: minute,
      endMin: minute + duration,
      walkingMinutes: walk,
      queueMinutes: queue.waitTime,
      memberIds: profile.members.map((member) => member.id),
    };
    if (step.endMin <= departure) {
      steps.push(step);
      minute = step.endMin;
      walkingTotal += walk;
      previousAttraction = ride;
    }
  });

  if (mealEnabled && !mealInserted && steps.length > 0) insertMeal();

  const coreEnd = minute;
  if (steps.length > 0 && departure - minute >= 25) {
    steps.push({
      id: `day-${day.index + 1}-flex`,
      kind: "flex",
      startMin: minute,
      endMin: departure,
      title: "Bufor na prawdziwy park",
      description: "Kolejki, toalety, odpoczynek, powtórki i spontaniczne decyzje. Rdzeń planu jest gotowy — tej części celowo nie wypełniamy co do minuty.",
    });
    minute = departure;
  }

  return {
    day: day.index + 1,
    label: `Dzień ${day.index + 1}`,
    steps,
    stats: {
      attractions: steps.reduce((total, step) => total + (step.kind === "split" ? 2 : step.kind === "ride" ? 1 : 0), 0),
      walkingMinutes: walkingTotal,
      start: formatPlanTime(arrival),
      end: formatPlanTime(Math.min(minute, departure)),
      coreEnd: formatPlanTime(Math.min(coreEnd, departure)),
    },
  };
}

export function buildUniversalPlan(profile, { attractions = ALL_ATTRACTIONS, queueById = {} } = {}) {
  const members = Array.isArray(profile?.members) ? profile.members : [];
  const dayCount = Math.min(3, Math.max(1, Number(profile?.dayCount) || 1));
  const capacity = PACE_CAPACITY[profile?.pace] ?? PACE_CAPACITY.normal;
  const usedIds = new Set();

  const ranked = attractions
    .map((attraction) => {
      const queue = queueStateFor(attraction, queueById);
      const eligibility = evaluatePartyEligibility(attraction, members);
      return {
        attraction,
        eligibility,
        queue,
        score: preferenceScore(attraction, profile, queue) + (eligibility.allEligible ? 58 : 0),
      };
    })
    .filter((entry) => entry.queue.isOpen)
    .filter((entry) => !(profile.preferences?.wet === "avoid" && entry.attraction.wet))
    .filter((entry) => entry.queue.waitTime === null || entry.queue.waitTime <= (profile.preferences?.maxQueue ?? 45) + 30)
    .sort((a, b) => b.score - a.score || b.attraction.priority - a.attraction.priority);

  const splitLimit = profile.splitPolicy === "often" ? dayCount : profile.splitPolicy === "worthwhile" ? 1 : 0;
  const splitItems = [];
  if (splitLimit > 0) {
    ranked
      .filter((entry) => !entry.eligibility.allEligible)
      .forEach((entry) => {
        if (splitItems.length >= splitLimit || usedIds.has(entry.attraction.id)) return;
        const split = buildSplitCandidate(entry.attraction, profile, attractions, queueById, usedIds);
        if (!split) return;
        splitItems.push(split);
        usedIds.add(split.attractionId);
        usedIds.add(split.alternativeAttractionId);
      });
  }

  const targetWholeRides = Math.max(dayCount * 3, dayCount * capacity - splitItems.length);
  const wholeItems = ranked
    .filter((entry) => entry.eligibility.allEligible && !usedIds.has(entry.attraction.id))
    .slice(0, targetWholeRides)
    .map((entry) => ({
      kind: "ride",
      attractionId: entry.attraction.id,
      zone: entry.attraction.zone,
      routeOrder: entry.attraction.routeOrder,
      score: entry.score,
      why: entry.queue.waitTime === null
        ? "Pasuje całej grupie i do waszych preferencji."
        : `Pasuje całej grupie; kolejka około ${entry.queue.waitTime} min.`,
    }));

  const allocated = allocateToDays([...wholeItems, ...splitItems], dayCount, capacity);
  const days = allocated.map((day) => scheduleDay(day, profile, queueById));
  const plan = {
    version: 1,
    generatedAt: new Date().toISOString(),
    profile: {
      dayCount,
      arrivalTime: normalizeTime(profile.arrivalTime, "10:00"),
      departureTime: normalizeTime(profile.departureTime, "20:00"),
      pace: profile.pace,
      splitPolicy: profile.splitPolicy,
      preferences: profile.preferences,
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

  if (memberIds.size !== members.length) issues.push("Uczestnicy muszą mieć unikalne identyfikatory.");

  for (const day of plan?.days ?? []) {
    let previousEnd = arrival;
    for (const step of day.steps ?? []) {
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
      }
      if (step.kind === "split") {
        const seen = new Set();
        for (const assignment of step.assignments ?? []) {
          const ride = ALL_ATTRACTIONS_BY_ID[assignment.attractionId];
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
        }
        if (seen.size !== memberIds.size || [...memberIds].some((id) => !seen.has(id))) {
          issues.push(`${day.label}: podział nie obejmuje całej grupy.`);
        }
        if (!step.reunion?.time) issues.push(`${day.label}: podział bez czasu spotkania.`);
      }
      if (!new Set(["ride", "split", "meal", "flex"]).has(step.kind)) {
        issues.push(`${day.label}: nieznany rodzaj kroku.`);
      }
    }
  }
  return { valid: issues.length === 0, issues };
}

export function attractionLabel(attraction) {
  if (!attraction) return "Atrakcja";
  const restrictions = restrictionsFor(attraction);
  const guarded = finiteNumber(restrictions.minHeightWithGuardian);
  const solo = finiteNumber(restrictions.soloHeight);
  const max = finiteNumber(restrictions.maxHeight);
  if (guarded !== null && solo !== null && guarded < solo) return `${guarded} cm z opiekunem · ${solo} cm samodzielnie`;
  if (solo !== null && max !== null) return `${solo}–${max} cm`;
  if (solo !== null) return `od ${solo} cm`;
  if (restrictions.minAgeWithGuardian != null) return `od ${restrictions.minAgeWithGuardian} lat z opiekunem`;
  return "sprawdź ograniczenia";
}

export function zoneLabel(zone) {
  return ZONES[zone]?.name ?? "Energylandia";
}
