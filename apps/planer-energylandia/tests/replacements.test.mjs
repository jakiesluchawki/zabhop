import assert from "node:assert/strict";
import test from "node:test";
import { ALL_ATTRACTIONS_BY_ID } from "../src/extendedData.js";
import { buildUniversalPlan, evaluatePartyEligibility, validatePlanSafety } from "../src/planner.js";
import {
  replacementOptionsForPlan,
  replacementTargetForPlan,
  replacePlannedAttraction,
} from "../src/replacements.js";

const NOW = Date.parse("2026-08-23T10:30:00.000Z");
const CHECKED_AT = "2026-08-23T10:20:00.000Z";

function profile(overrides = {}) {
  return {
    dayCount: 1,
    visitStartDate: "2026-08-23",
    arrivalTime: "10:00",
    departureTime: "20:00",
    pace: "normal",
    splitPolicy: "never",
    members: [
      { id: "a1", role: "adult", name: "A1", age: 35, height: 175 },
      { id: "a2", role: "adult", name: "A2", age: 35, height: 175 },
      { id: "c1", role: "child", name: "C1", age: 6, height: 120 },
      { id: "c2", role: "child", name: "C2", age: 6, height: 120 },
    ],
    preferences: { intensity: "mixed", interests: ["coasters", "family"], wet: "ok", maxQueue: 45 },
    meal: { mode: "fast", time: "13:15" },
    queueSnapshotAt: Date.parse(CHECKED_AT),
    ...overrides,
  };
}

function planFor(overrides = {}) {
  return buildUniversalPlan(profile(overrides), { now: NOW });
}

function rideRequest(plan, attractionId = null) {
  const ride = plan.days[0].steps.find((step) =>
    step.kind === "ride" && (attractionId === null || step.attractionId === attractionId),
  );
  assert.ok(ride);
  return { dayIndex: 0, stepId: ride.id };
}

function freshQueue(overrides = {}) {
  return {
    isOpen: true,
    waitTime: 0,
    updatedAt: CHECKED_AT,
    freshness: "fresh",
    stale: false,
    ...overrides,
  };
}

function calendar(status, { checkedAt = CHECKED_AT, closesAt = "20:00" } = {}) {
  return {
    source: { url: "https://energylandia.pl/kalendarz/", checkedAt, status: "fresh" },
    days: {
      "2026-08-23": {
        date: "2026-08-23",
        status,
        opensAt: status === "open" ? "10:00" : null,
        closesAt: status === "open" ? closesAt : null,
        shows: [],
      },
    },
  };
}

test("podmiana zachowuje bezpieczny slot, obiad, koniec dnia oraz nie zmienia oryginału", () => {
  const plan = planFor();
  const request = rideRequest(plan);
  const originalRide = plan.days[0].steps.find((step) => step.id === request.stepId);
  const originalMeal = plan.days[0].steps.find((step) => step.kind === "meal");
  const options = replacementOptionsForPlan(plan, request, { now: NOW });

  assert.ok(options.length > 0 && options.length <= 3);
  assert.ok(options.every((option) => option.estimatedSlotMinutes <= originalRide.endMin - originalRide.startMin));

  const replacementId = options[0].attraction.id;
  const next = replacePlannedAttraction(plan, request, replacementId, { now: NOW });
  const replaced = next.days[0].steps.find((step) => step.id === request.stepId);

  assert.equal(replaced.attractionId, replacementId);
  assert.equal(replaced.startMin, originalRide.startMin);
  assert.equal(replaced.endMin, originalRide.endMin);
  assert.deepEqual(next.days[0].steps.find((step) => step.kind === "meal"), originalMeal);
  assert.equal(next.days[0].stats.end, plan.days[0].stats.end);
  assert.equal(next.firstAttractionId, replacementId);
  assert.equal(validatePlanSafety(next).valid, true);
  assert.equal(originalRide.attractionId, "honey-harbour");
});

test("atrakcję zapasową można bezpiecznie promować bez powielenia w buforze", () => {
  const plan = planFor();
  const request = rideRequest(plan, "abyssus");
  const backups = plan.days[0].steps.at(-1).backupAttractionIds;
  const option = replacementOptionsForPlan(plan, request, { now: NOW })
    .find((entry) => backups.includes(entry.attraction.id));
  assert.ok(option);

  const next = replacePlannedAttraction(plan, request, option.attraction.id, { now: NOW });
  assert.deepEqual(
    next.days[0].steps.at(-1).backupAttractionIds,
    backups.filter((attractionId) => attractionId !== option.attraction.id),
  );
  assert.ok(plan.days[0].steps.at(-1).backupAttractionIds.includes(option.attraction.id));
  assert.equal(validatePlanSafety(next).valid, true);
});

test("odrzucone i zaplanowane atrakcje nie wracają, a kolejny bezpieczny wynik można zaakceptować", () => {
  const plan = planFor();
  const request = rideRequest(plan);
  const initial = replacementOptionsForPlan(plan, request, { now: NOW });
  const rejectedIds = initial.map((entry) => entry.attraction.id);
  const remaining = replacementOptionsForPlan(plan, request, { now: NOW, rejectedIds });
  const used = new Set(plan.days.flatMap((day) => day.steps.flatMap((step) =>
    step.kind === "ride"
      ? [step.attractionId]
      : step.kind === "split"
        ? step.assignments.map((assignment) => assignment.attractionId)
        : [],
  )));

  assert.ok(remaining.length > 0);
  assert.ok(remaining.every((entry) => !rejectedIds.includes(entry.attraction.id)));
  assert.ok(remaining.every((entry) => !used.has(entry.attraction.id)));
  assert.equal(
    validatePlanSafety(replacePlannedAttraction(plan, request, remaining[0].attraction.id, { now: NOW })).valid,
    true,
  );
});

test("każdy zamiennik respektuje minimalny wzrost, wiek i wymaganą liczbę opiekunów", () => {
  const plan = planFor();
  const request = rideRequest(plan);
  const options = replacementOptionsForPlan(plan, request, { now: NOW });

  assert.ok(options.every((entry) => evaluatePartyEligibility(entry.attraction, plan.profile.members).allEligible));
  assert.equal(options.some((entry) => ["hyperion", "zadra", "tsunami-drop"].includes(entry.attraction.id)), false);
  assert.throws(() => replacePlannedAttraction(plan, request, "hyperion", { now: NOW }), TypeError);
});

test("świeże zamknięcie oraz potwierdzona zbyt długa kolejka wykluczają zamiennik", () => {
  const plan = planFor();
  const request = rideRequest(plan);
  const id = replacementOptionsForPlan(plan, request, { now: NOW })[0].attraction.id;

  for (const queue of [freshQueue({ isOpen: false }), freshQueue({ waitTime: 90 })]) {
    const options = replacementOptionsForPlan(plan, request, { now: NOW, queueById: { [id]: queue } });
    assert.equal(options.some((entry) => entry.attraction.id === id), false);
  }
});

test("stary pomiar atrakcji i nieświeży snapshot nie udają potwierdzonego zamknięcia", () => {
  const plan = planFor();
  const request = rideRequest(plan);
  const id = replacementOptionsForPlan(plan, request, { now: NOW })[0].attraction.id;
  const staleRide = freshQueue({ isOpen: false, updatedAt: "2026-08-23T07:00:00.000Z" });

  const rideUnknown = replacementOptionsForPlan(plan, request, { now: NOW, queueById: { [id]: staleRide } });
  assert.equal(rideUnknown.some((entry) => entry.attraction.id === id), true);

  const stalePlan = structuredClone(plan);
  stalePlan.queueSnapshotAt = Date.parse("2026-08-23T07:00:00.000Z");
  const snapshotUnknown = replacementOptionsForPlan(stalePlan, request, {
    now: NOW,
    queueById: { [id]: freshQueue({ isOpen: false }) },
  });
  assert.equal(snapshotUnknown.some((entry) => entry.attraction.id === id), true);
});

test("świeży kalendarz blokuje zamknięty dzień i slot po zamknięciu, stary pozostaje niepewny", () => {
  const plan = planFor();
  const request = rideRequest(plan);

  assert.deepEqual(replacementOptionsForPlan(plan, request, { now: NOW, parkCalendar: calendar("closed") }), []);
  assert.deepEqual(
    replacementOptionsForPlan(plan, request, { now: NOW, parkCalendar: calendar("open", { closesAt: "10:10" }) }),
    [],
  );
  assert.ok(replacementOptionsForPlan(plan, request, {
    now: NOW,
    parkCalendar: calendar("closed", { checkedAt: "2026-08-20T10:20:00.000Z" }),
  }).length > 0);
});

test("zamiana pierwszej odnogi zachowuje opiekunów i aktualizuje miejsce spotkania", () => {
  const plan = planFor({
    splitPolicy: "often",
    members: [
      { id: "a1", role: "adult", name: "A1", age: 35, height: 175 },
      { id: "a2", role: "adult", name: "A2", age: 35, height: 175 },
      { id: "c1", role: "child", name: "C1", age: 15, height: 145 },
      { id: "c2", role: "child", name: "C2", age: 6, height: 120 },
    ],
    preferences: { intensity: "thrill", interests: ["coasters"], wet: "ok", maxQueue: 90 },
  });
  const split = plan.days[0].steps.find((step) => step.kind === "split");
  assert.ok(split);

  const request = { dayIndex: 0, stepId: split.id, assignmentIndex: 0 };
  const option = replacementOptionsForPlan(plan, request, { now: NOW })[0];
  assert.ok(option);
  const next = replacePlannedAttraction(plan, request, option.attraction.id, { now: NOW });
  const nextSplit = next.days[0].steps.find((step) => step.id === split.id);

  assert.equal(nextSplit.attractionId, option.attraction.id);
  assert.equal(nextSplit.assignments[0].attractionId, option.attraction.id);
  assert.match(nextSplit.reunion.label, new RegExp(option.attraction.name));
  assert.deepEqual(nextSplit.assignments[0].memberIds, split.assignments[0].memberIds);
  assert.equal(validatePlanSafety(next).valid, true);
});

test("zamiana drugiej odnogi aktualizuje jej identyfikator bez ruszania miejsca spotkania", () => {
  const plan = planFor({
    splitPolicy: "often",
    members: [
      { id: "a1", role: "adult", name: "A1", age: 35, height: 175 },
      { id: "a2", role: "adult", name: "A2", age: 35, height: 175 },
      { id: "c1", role: "child", name: "C1", age: 15, height: 145 },
      { id: "c2", role: "child", name: "C2", age: 6, height: 120 },
    ],
    preferences: { intensity: "thrill", interests: ["coasters"], wet: "ok", maxQueue: 90 },
  });
  const split = plan.days[0].steps.find((step) => step.kind === "split");
  const request = { dayIndex: 0, stepId: split.id, assignmentIndex: 1 };
  const option = replacementOptionsForPlan(plan, request, { now: NOW })[0];
  assert.ok(option);

  const next = replacePlannedAttraction(plan, request, option.attraction.id, { now: NOW });
  const nextSplit = next.days[0].steps.find((step) => step.id === split.id);
  assert.equal(nextSplit.alternativeAttractionId, option.attraction.id);
  assert.equal(nextSplit.assignments[1].attractionId, option.attraction.id);
  assert.deepEqual(nextSplit.reunion, split.reunion);
  assert.equal(validatePlanSafety(next).valid, true);
});

test("informacja o wymienianym punkcie nie pozwala podmienić obiadu ani pustej odnogi", () => {
  const plan = planFor();
  const request = rideRequest(plan);
  const target = replacementTargetForPlan(plan, request);
  assert.equal(target.attraction.id, "honey-harbour");
  assert.deepEqual(target.memberIds, plan.profile.members.map((member) => member.id));

  const meal = plan.days[0].steps.find((step) => step.kind === "meal");
  assert.equal(replacementTargetForPlan(plan, { dayIndex: 0, stepId: meal.id }), null);
  assert.deepEqual(replacementOptionsForPlan(plan, { dayIndex: 0, stepId: meal.id }, { now: NOW }), []);
  assert.equal(replacementTargetForPlan(plan, { dayIndex: -1, stepId: request.stepId }), null);
  assert.equal(replacementTargetForPlan(plan, { dayIndex: 0, stepId: "nie-ma" }), null);
  assert.ok(ALL_ATTRACTIONS_BY_ID[target.attraction.id]);
});
