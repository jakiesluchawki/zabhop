import { ALL_ATTRACTIONS, ALL_ATTRACTIONS_BY_ID, RESTAURANTS } from "./extendedData.js";
import { parkDayForDate } from "./parkCalendar.js";
import { distanceMeters, walkingMinutes } from "./parkLogic.js";
import { evaluatePartyEligibility, timeToMinutes, validatePlanSafety, zoneLabel } from "./planner.js";
import { QUEUE_STALE_AFTER_MINUTES } from "./queues.js";

const RESTAURANTS_BY_ID = Object.freeze(Object.fromEntries(
  RESTAURANTS.map((restaurant) => [restaurant.id, restaurant]),
));
const REPLACEMENT_TRANSITION_MINUTES = 5;

function finiteTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function warsawDateKey(timestamp) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function visitDateForDay(plan, dayIndex) {
  const startDate = String(plan?.profile?.visitStartDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
  const date = new Date(`${startDate}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== startDate) return null;
  date.setUTCDate(date.getUTCDate() + dayIndex);
  return date.toISOString().slice(0, 10);
}

function targetFor(plan, { dayIndex = 0, stepId, assignmentIndex = null } = {}) {
  const index = Number(dayIndex);
  if (!Number.isInteger(index) || index < 0 || typeof stepId !== "string") return null;

  const day = plan?.days?.[index];
  const step = day?.steps?.find((candidate) => candidate?.id === stepId);
  if (!day || !step || !["ride", "split"].includes(step.kind)) return null;

  if (step.kind === "ride") {
    const attraction = ALL_ATTRACTIONS_BY_ID[step.attractionId];
    return attraction
      ? { dayIndex: index, day, step, attraction, memberIds: step.memberIds || [], assignmentIndex: null }
      : null;
  }

  if (assignmentIndex === null || assignmentIndex === undefined || assignmentIndex === "") return null;
  const branchIndex = Number(assignmentIndex);
  const assignment = Number.isInteger(branchIndex) && branchIndex >= 0
    ? step.assignments?.[branchIndex]
    : null;
  const attraction = assignment ? ALL_ATTRACTIONS_BY_ID[assignment.attractionId] : null;
  return attraction
    ? {
        dayIndex: index,
        day,
        step,
        assignment,
        attraction,
        memberIds: assignment.memberIds || [],
        assignmentIndex: branchIndex,
      }
    : null;
}

function membersByIds(plan, ids = []) {
  const wanted = new Set(ids);
  return (plan?.profile?.members || []).filter((member) => wanted.has(member.id));
}

function reservedAttractionIds(plan) {
  const reserved = new Set();
  (plan?.days || []).forEach((day) => (day?.steps || []).forEach((step) => {
    if (step?.kind === "ride") reserved.add(step.attractionId);
    if (step?.kind === "split") {
      (step.assignments || []).forEach((assignment) => reserved.add(assignment.attractionId));
    }
  }));
  return reserved;
}

function snapshotIsTrustworthy(plan, target, now) {
  if (target.dayIndex !== 0 || !Number.isFinite(now)) return false;
  const visitDate = visitDateForDay(plan, target.dayIndex);
  const timestamp = finiteTimestamp(plan?.queueSnapshotAt);
  if (!visitDate || timestamp === null || warsawDateKey(now) !== visitDate) return false;
  if (warsawDateKey(timestamp) !== visitDate) return false;

  const ageMinutes = (now - timestamp) / 60_000;
  return ageMinutes >= -5 && ageMinutes <= QUEUE_STALE_AFTER_MINUTES;
}

function trustedQueueFor(attractionId, queueById, trustedSnapshot, now) {
  if (!trustedSnapshot) return null;
  const queue = queueById?.[attractionId];
  if (!queue || queue.stale === true || ["stale", "unknown", "unavailable"].includes(queue.freshness)) {
    return null;
  }

  const rideTimestamp = finiteTimestamp(queue.updatedAt ?? queue.lastUpdated ?? queue.last_updated);
  if (rideTimestamp === null) return null;
  const ageMinutes = (now - rideTimestamp) / 60_000;
  if (ageMinutes < -5 || ageMinutes > QUEUE_STALE_AFTER_MINUTES) return null;

  if (typeof queue.isOpen !== "boolean") return null;
  return {
    ...queue,
    waitTime: queue.isOpen && Number.isFinite(queue.waitTime) ? queue.waitTime : null,
  };
}

function hardPreferenceMatch(attraction, profile, queue) {
  const preferences = profile?.preferences || {};
  if (preferences.wet === "avoid" && attraction.wet) return false;
  if (preferences.intensity === "calm" && (attraction.thrillLevel ?? 2) > 2) return false;
  if (queue?.isOpen === false) return false;
  if (Number.isFinite(queue?.waitTime) && queue.waitTime > (preferences.maxQueue ?? 45)) return false;
  return true;
}

function previousAnchorFor(target) {
  const index = target.day.steps.findIndex((step) => step.id === target.step.id);
  for (let position = index - 1; position >= 0; position -= 1) {
    const step = target.day.steps[position];
    if (step.kind === "ride" || step.kind === "split") {
      const attraction = ALL_ATTRACTIONS_BY_ID[step.attractionId];
      if (attraction) return attraction;
    }
    if (step.kind === "meal") {
      const restaurant = RESTAURANTS_BY_ID[step.restaurantId];
      if (restaurant) return restaurant;
    }
    if (step.kind === "show" && step.location) return step.location;
  }
  return null;
}

function safeDistance(from, destination) {
  try {
    const meters = distanceMeters(from, destination);
    return Number.isFinite(meters) && meters >= 0 ? meters : null;
  } catch {
    return null;
  }
}

function cautiousQueueMinutes(queue) {
  if (!Number.isFinite(queue?.waitTime)) return 25;
  return Math.max(25, Math.ceil((queue.waitTime * 1.35) / 5) * 5);
}

function walkFrom(anchor, attraction) {
  if (!anchor) return 0;
  const meters = safeDistance(anchor, attraction);
  return meters === null ? null : walkingMinutes(meters);
}

function estimatedSlotMinutes(target, candidate, queueById, trustedSnapshot, now) {
  const anchor = previousAnchorFor(target);
  const candidateQueue = trustedQueueFor(candidate.id, queueById, trustedSnapshot, now);

  if (target.step.kind === "ride") {
    const walk = walkFrom(anchor, candidate);
    return walk === null
      ? null
      : walk + cautiousQueueMinutes(candidateQueue) + (candidate.durationMinutes ?? 4) + REPLACEMENT_TRANSITION_MINUTES;
  }

  const rides = (target.step.assignments || []).map((assignment, index) =>
    index === target.assignmentIndex ? candidate : ALL_ATTRACTIONS_BY_ID[assignment.attractionId],
  );
  const main = rides[0];
  const alternative = rides[1];
  if (!main || !alternative || rides.length !== 2) return null;

  const mainWalk = walkFrom(anchor, main);
  const alternativeWalk = walkFrom(anchor, alternative);
  const reunionDistance = safeDistance(alternative, main);
  if (mainWalk === null || alternativeWalk === null || reunionDistance === null) return null;

  const mainQueue = trustedQueueFor(main.id, queueById, trustedSnapshot, now);
  const alternativeQueue = trustedQueueFor(alternative.id, queueById, trustedSnapshot, now);
  const mainDuration = mainWalk + cautiousQueueMinutes(mainQueue) + (main.durationMinutes ?? 4) + 7;
  const alternativeDuration = alternativeWalk
    + cautiousQueueMinutes(alternativeQueue)
    + (alternative.durationMinutes ?? 4)
    + 7
    + walkingMinutes(reunionDistance);

  return Math.max(mainDuration, alternativeDuration, 30) + 8;
}

function sharedTagScore(current, candidate) {
  const currentTags = new Set(current.tags || []);
  return (candidate.tags || []).reduce((score, tag) => score + (currentTags.has(tag) ? 1 : 0), 0);
}

function officialDayAllowsTarget(plan, target, parkCalendar, now) {
  if (!parkCalendar) return true;
  const date = visitDateForDay(plan, target.dayIndex);
  if (!date) return true;

  const officialDay = parkDayForDate(parkCalendar, date, { now });
  if (officialDay.state === "closed") return false;
  if (officialDay.state !== "open") return true;

  return target.step.startMin >= timeToMinutes(officialDay.opensAt, 0)
    && target.step.endMin <= timeToMinutes(officialDay.closesAt, 1439);
}

function rankedReplacementOptions(
  plan,
  request,
  { queueById = {}, rejectedIds = [], parkCalendar = null, now = Date.now() } = {},
) {
  const target = targetFor(plan, request);
  const timestamp = now instanceof Date ? now.getTime() : Number(now);
  if (!target || !Number.isFinite(timestamp) || !officialDayAllowsTarget(plan, target, parkCalendar, timestamp)) {
    return [];
  }

  const slotMinutes = target.step.endMin - target.step.startMin;
  if (!Number.isFinite(slotMinutes) || slotMinutes <= 0) return [];

  const reserved = reservedAttractionIds(plan);
  reserved.delete(target.attraction.id);
  const rejected = new Set(Array.isArray(rejectedIds) ? rejectedIds : []);
  const members = membersByIds(plan, target.memberIds);
  if (members.length !== target.memberIds.length || members.length === 0) return [];
  const trustedSnapshot = snapshotIsTrustworthy(plan, target, timestamp);

  return ALL_ATTRACTIONS
    .filter((candidate) => candidate.id !== target.attraction.id)
    .filter((candidate) => !reserved.has(candidate.id) && !rejected.has(candidate.id))
    .filter((candidate) => candidate.defaultStatus !== "closed" && !candidate.toddlerLike)
    .map((candidate) => {
      const distance = safeDistance(target.attraction, candidate);
      if (distance === null || distance > 700) return null;

      const queue = trustedQueueFor(candidate.id, queueById, trustedSnapshot, timestamp);
      const walk = walkingMinutes(distance);
      const sameZone = candidate.zone === target.attraction.zone;
      const eligibility = evaluatePartyEligibility(candidate, members);
      const estimate = estimatedSlotMinutes(target, candidate, queueById, trustedSnapshot, timestamp);
      if (!eligibility.allEligible || estimate === null || estimate > slotMinutes) return null;
      if (!hardPreferenceMatch(candidate, plan.profile, queue)) return null;

      const score = (sameZone ? 70 : 0)
        + sharedTagScore(target.attraction, candidate) * 18
        + Math.min(30, candidate.priority ?? 50) / 3
        - Math.abs((candidate.thrillLevel ?? 2) - (target.attraction.thrillLevel ?? 2)) * 14
        - distance / 22
        - (Number.isFinite(queue?.waitTime) ? queue.waitTime * 0.65 : 0);

      return {
        attraction: candidate,
        queue,
        distance,
        walkingMinutes: walk,
        sameZone,
        eligibility,
        estimatedSlotMinutes: estimate,
        score,
        reason: sameZone
          ? `Ta sama strefa · około ${walk} min od wymienianego punktu`
          : `${zoneLabel(candidate.zone)} · około ${walk} min od wymienianego punktu`,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.distance - right.distance);
}

export function replacementOptionsForPlan(plan, request, options = {}) {
  return rankedReplacementOptions(plan, request, options).slice(0, 3);
}

function currentFirstAttractionId(days) {
  return (days || [])
    .flatMap((day) => day.steps || [])
    .find((step) => step.kind === "ride" || step.kind === "split")?.attractionId ?? null;
}

export function replacePlannedAttraction(plan, request, replacementId, options = {}) {
  const target = targetFor(plan, request);
  const replacement = ALL_ATTRACTIONS_BY_ID[replacementId];
  const allowed = replacement && rankedReplacementOptions(plan, request, options)
    .some((entry) => entry.attraction.id === replacement.id);

  if (!target || !replacement || !allowed) {
    throw new TypeError("Wybrany zamiennik nie jest bezpieczny dla tej grupy lub nie mieści się w planie.");
  }

  const timestamp = options.now instanceof Date ? options.now.getTime() : Number(options.now ?? Date.now());
  const trustedSnapshot = snapshotIsTrustworthy(plan, target, timestamp);
  const queue = trustedQueueFor(replacement.id, options.queueById || {}, trustedSnapshot, timestamp);
  const next = structuredClone(plan);
  const nextStep = next.days[target.dayIndex].steps.find((step) => step.id === target.step.id);

  next.days.forEach((day) => (day.steps || []).forEach((step) => {
    if (step.kind === "flex" && Array.isArray(step.backupAttractionIds)) {
      step.backupAttractionIds = step.backupAttractionIds.filter((attractionId) => attractionId !== replacement.id);
    }
  }));

  if (nextStep.kind === "ride") {
    nextStep.attractionId = replacement.id;
    nextStep.zone = replacement.zone;
    nextStep.queueMinutes = Number.isFinite(queue?.waitTime) ? queue.waitTime : null;
  } else {
    const assignment = nextStep.assignments[target.assignmentIndex];
    assignment.attractionId = replacement.id;
    assignment.queueMinutes = Number.isFinite(queue?.waitTime) ? queue.waitTime : null;

    if (target.assignmentIndex === 0) {
      nextStep.attractionId = replacement.id;
      nextStep.zone = replacement.zone;
      if (nextStep.reunion) {
        nextStep.reunion.label = `Spotkanie przy ${replacement.name}`;
        nextStep.reunion.location = replacement.location || { lat: replacement.lat, lon: replacement.lon };
      }
    } else if (target.assignmentIndex === 1) {
      nextStep.alternativeAttractionId = replacement.id;
    }
  }

  next.firstAttractionId = currentFirstAttractionId(next.days);
  next.safety = validatePlanSafety(next);
  if (!next.safety.valid) {
    throw new TypeError(`Zamiana narusza bezpieczeństwo planu: ${next.safety.issues.join(" ")}`);
  }
  return next;
}

export function replacementTargetForPlan(plan, request) {
  const target = targetFor(plan, request);
  return target ? { attraction: target.attraction, memberIds: [...target.memberIds] } : null;
}
