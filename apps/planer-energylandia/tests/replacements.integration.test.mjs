import assert from "node:assert/strict";
import test from "node:test";
import { ALL_ATTRACTIONS_BY_ID } from "../src/extendedData.js";
import { buildUniversalPlan, evaluatePartyEligibility, validatePlanSafety } from "../src/planner.js";
import { replacementOptionsForPlan, replacePlannedAttraction } from "../src/replacements.js";

const now = Date.parse("2026-08-23T10:30:00.000Z");
const checkedAt = "2026-08-23T10:20:00.000Z";

function profile(overrides = {}) {
  return {
    dayCount: 1,
    visitStartDate: "2026-08-23",
    arrivalTime: "10:00",
    departureTime: "20:00",
    pace: "normal",
    splitPolicy: "never",
    members: [
      { id: "adult-1", role: "adult", name: "Dorosły 1", age: 35, height: 175 },
      { id: "adult-2", role: "adult", name: "Dorosły 2", age: 34, height: 170 },
      { id: "child-1", role: "child", name: "Dziecko 1", age: 6, height: 120 },
      { id: "child-2", role: "child", name: "Dziecko 2", age: 6, height: 120 },
    ],
    preferences: { intensity: "mixed", interests: ["coasters", "family"], wet: "ok", maxQueue: 45 },
    meal: { mode: "fast", time: "13:15" },
    entertainment: { includeShows: false },
    queueSnapshotAt: Date.parse(checkedAt),
    ...overrides,
  };
}

function firstRideRequest(plan) {
  const ride = plan.days[0].steps.find((step) => step.kind === "ride");
  assert.ok(ride, "plan musi zawierać krok atrakcji");
  return { dayIndex: 0, stepId: ride.id };
}

function confirmedQueue(overrides = {}) {
  return {
    isOpen: true,
    waitTime: 0,
    updatedAt: checkedAt,
    freshness: "fresh",
    stale: false,
    ...overrides,
  };
}

function officialDay(status, overrides = {}) {
  const date = overrides.date || "2026-08-23";
  return {
    source: {
      url: "https://energylandia.pl/kalendarz/",
      checkedAt,
      status: "fresh",
    },
    days: {
      [date]: {
        date,
        status,
        opensAt: status === "open" ? overrides.opensAt || "10:00" : null,
        closesAt: status === "open" ? overrides.closesAt || "20:00" : null,
        shows: [],
      },
    },
  };
}

test("wymiana uwzględnia tylko świeże zamknięcie z dnia wizyty, nie stary wpis ani jutro", () => {
  const today = buildUniversalPlan(profile(), { now });
  const request = firstRideRequest(today);
  const initial = replacementOptionsForPlan(today, request, { now });
  assert.ok(initial.length > 0, "potrzebna jest przynajmniej jedna bezpieczna alternatywa");
  const alternativeId = initial[0].attraction.id;

  const confirmedClosed = replacementOptionsForPlan(today, request, {
    now,
    queueById: { [alternativeId]: confirmedQueue({ isOpen: false, waitTime: null }) },
  });
  assert.equal(confirmedClosed.some((option) => option.attraction.id === alternativeId), false);

  const staleClosure = replacementOptionsForPlan(today, request, {
    now,
    queueById: {
      [alternativeId]: confirmedQueue({
        isOpen: false,
        waitTime: null,
        updatedAt: "2026-08-23T07:00:00.000Z",
        freshness: "stale",
        stale: true,
      }),
    },
  });
  assert.equal(staleClosure.some((option) => option.attraction.id === alternativeId), true);

  const undatedClosure = replacementOptionsForPlan(today, request, {
    now,
    queueById: {
      [alternativeId]: confirmedQueue({
        isOpen: false,
        waitTime: null,
        updatedAt: null,
      }),
    },
  });
  assert.equal(undatedClosure.some((option) => option.attraction.id === alternativeId), true);

  const future = buildUniversalPlan(profile({ visitStartDate: "2026-08-24" }), { now });
  const futureRequest = firstRideRequest(future);
  const futureOptions = replacementOptionsForPlan(future, futureRequest, { now });
  assert.ok(futureOptions.length > 0);
  const futureAlternative = futureOptions[0].attraction.id;
  const tomorrowIgnoresToday = replacementOptionsForPlan(future, futureRequest, {
    now,
    queueById: { [futureAlternative]: confirmedQueue({ isOpen: false, waitTime: null }) },
  });
  assert.equal(tomorrowIgnoresToday.some((option) => option.attraction.id === futureAlternative), true);
});

test("dzień zamknięty albo slot po oficjalnej godzinie zamknięcia nie dostaje zamiennika", () => {
  const plan = buildUniversalPlan(profile(), { now });
  const request = firstRideRequest(plan);
  const closed = replacementOptionsForPlan(plan, request, {
    now,
    parkCalendar: officialDay("closed"),
  });
  assert.deepEqual(closed, []);

  const tooShort = replacementOptionsForPlan(plan, request, {
    now,
    parkCalendar: officialDay("open", { closesAt: "10:05" }),
  });
  assert.deepEqual(tooShort, []);

  const staleCalendar = officialDay("closed");
  staleCalendar.source.checkedAt = "2026-08-20T10:20:00.000Z";
  assert.ok(replacementOptionsForPlan(plan, request, { now, parkCalendar: staleCalendar }).length > 0);
});

test("alternatywa musi zmieścić się w slocie i zachować limity całej grupy", () => {
  const plan = buildUniversalPlan(profile({
    preferences: { intensity: "mixed", interests: ["coasters", "family"], wet: "ok", maxQueue: 90 },
  }), { now });
  const request = firstRideRequest(plan);
  const options = replacementOptionsForPlan(plan, request, { now });
  assert.ok(options.length > 0);
  assert.ok(options.every((option) => evaluatePartyEligibility(option.attraction, plan.profile.members).allEligible));
  assert.equal(options.some((option) => option.attraction.id === "hyperion"), false);

  const candidate = options[0].attraction.id;
  const exceedsSlot = replacementOptionsForPlan(plan, request, {
    now,
    queueById: { [candidate]: confirmedQueue({ waitTime: 90 }) },
  });
  assert.equal(exceedsSlot.some((option) => option.attraction.id === candidate), false);

  assert.throws(
    () => replacePlannedAttraction(plan, request, ALL_ATTRACTIONS_BY_ID.hyperion.id, { now }),
    TypeError,
  );
});

test("odrzucona alternatywa nie wraca, a zamiana nie zmienia posiłku ani bufora", () => {
  const plan = buildUniversalPlan(profile(), { now });
  const request = firstRideRequest(plan);
  const options = replacementOptionsForPlan(plan, request, { now });
  assert.ok(options.length > 0);
  assert.ok(options.length <= 3);
  const rejectedId = options[0].attraction.id;
  const afterRejection = replacementOptionsForPlan(plan, request, {
    now,
    rejectedIds: [rejectedId],
  });
  assert.equal(afterRejection.some((option) => option.attraction.id === rejectedId), false);

  const replacement = replacePlannedAttraction(plan, request, rejectedId, { now });
  const nextPlan = replacement?.plan || replacement;
  assert.equal(validatePlanSafety(nextPlan).valid, true);
  assert.equal(nextPlan.days[0].steps.filter((step) => step.kind === "meal").length, 1);
  assert.equal(nextPlan.days[0].steps.at(-1).kind, "flex");
  assert.equal(nextPlan.days[0].stats.end, plan.days[0].stats.end);
  assert.equal(
    nextPlan.days.some((day) => day.steps.some((step) =>
      step.kind === "flex" && step.backupAttractionIds?.includes(rejectedId),
    )),
    false,
  );
});

test("wymiana w podziale zachowuje właściwego dorosłego przy dziecku i dokładny czas spotkania", () => {
  const plan = buildUniversalPlan(profile({
    splitPolicy: "often",
    members: [
      { id: "adult-1", role: "adult", name: "Dorosły 1", age: 35, height: 175 },
      { id: "adult-2", role: "adult", name: "Dorosły 2", age: 34, height: 170 },
      { id: "teen-1", role: "child", name: "Starsze dziecko", age: 15, height: 145 },
      { id: "child-1", role: "child", name: "Młodsze dziecko", age: 6, height: 120 },
    ],
    preferences: { intensity: "thrill", interests: ["coasters"], wet: "ok", maxQueue: 90 },
  }), { now });
  const split = plan.days[0].steps.find((step) => step.kind === "split");
  assert.ok(split, "profil mieszanych wzrostów powinien dostać bezpieczny podział");
  const request = { dayIndex: 0, stepId: split.id, assignmentIndex: 1 };
  const options = replacementOptionsForPlan(plan, request, { now });
  assert.ok(options.length > 0);
  assert.ok(options.every((option) => option.attraction.id !== "hyperion"));

  const nextPlan = replacePlannedAttraction(plan, request, options[0].attraction.id, { now });
  const nextSplit = nextPlan.days[0].steps.find((step) => step.id === split.id);
  assert.deepEqual(nextSplit.assignments[1].memberIds, split.assignments[1].memberIds);
  assert.equal(nextSplit.reunion.time, split.reunion.time);
  assert.equal(nextSplit.startMin, split.startMin);
  assert.equal(nextSplit.endMin, split.endMin);
  assert.equal(validatePlanSafety(nextPlan).valid, true);
});
