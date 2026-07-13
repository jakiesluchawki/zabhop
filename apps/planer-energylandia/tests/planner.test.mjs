import test from "node:test";
import assert from "node:assert/strict";
import { ALL_ATTRACTIONS_BY_ID } from "../src/extendedData.js";
import {
  buildUniversalPlan,
  evaluateMemberEligibility,
  evaluatePartyEligibility,
  timeToMinutes,
  validatePlanSafety,
} from "../src/planner.js";

const adult = (id, height = 175) => ({ id, role: "adult", name: id, age: 35, height });
const child = (id, age, height) => ({ id, role: "child", name: id, age, height });

function profile(overrides = {}) {
  return {
    dayCount: 1,
    arrivalTime: "10:00",
    departureTime: "20:00",
    pace: "normal",
    splitPolicy: "never",
    members: [adult("a1"), adult("a2"), child("c1", 6, 120), child("c2", 6, 120)],
    preferences: { intensity: "mixed", interests: ["coasters", "family"], wet: "ok", maxQueue: 45 },
    meal: { mode: "fast", time: "13:15" },
    ...overrides,
  };
}

test("progi 130, 140 i 195 cm są respektowane", () => {
  const tsunami = ALL_ATTRACTIONS_BY_ID["tsunami-drop"];
  const hyperion = ALL_ATTRACTIONS_BY_ID.hyperion;
  assert.equal(evaluateMemberEligibility(tsunami, child("c", 12, 129), { hasGuardian: true }).eligible, false);
  assert.equal(evaluateMemberEligibility(tsunami, child("c", 12, 130), { hasGuardian: true }).eligible, true);
  assert.equal(evaluateMemberEligibility(hyperion, child("c", 15, 139), { hasGuardian: true }).eligible, false);
  assert.equal(evaluateMemberEligibility(hyperion, child("c", 15, 140), { hasGuardian: true }).eligible, true);
  assert.equal(evaluateMemberEligibility(hyperion, adult("a", 195), { hasGuardian: true }).eligible, true);
  assert.equal(evaluateMemberEligibility(hyperion, adult("a", 196), { hasGuardian: true }).eligible, false);
});

test("Viking wymaga jednocześnie 140 cm i 12 lat", () => {
  const viking = ALL_ATTRACTIONS_BY_ID.viking;
  assert.equal(evaluateMemberEligibility(viking, child("c", 11, 150), { hasGuardian: true }).eligible, false);
  assert.equal(evaluateMemberEligibility(viking, child("c", 12, 139), { hasGuardian: true }).eligible, false);
  assert.equal(evaluateMemberEligibility(viking, child("c", 12, 140), { hasGuardian: true }).eligible, true);
});

test("konserwatywnie wymaga jednego opiekuna na dziecko zależne", () => {
  const formula = ALL_ATTRACTIONS_BY_ID.formula;
  assert.equal(evaluatePartyEligibility(formula, [adult("a1"), child("c1", 6, 120), child("c2", 6, 120)]).allEligible, false);
  assert.equal(evaluatePartyEligibility(formula, [adult("a1"), adult("a2"), child("c1", 6, 120), child("c2", 6, 120)]).allEligible, true);
});

test("jeden dorosły nigdy nie dostaje podziału grupy", () => {
  const plan = buildUniversalPlan(profile({
    splitPolicy: "often",
    members: [adult("a1"), child("c1", 6, 120)],
    preferences: { intensity: "thrill", interests: ["coasters"], wet: "ok", maxQueue: 90 },
  }));
  assert.equal(plan.days.flatMap((day) => day.steps).some((step) => step.kind === "split"), false);
  assert.equal(plan.safety.valid, true);
});

test("dwoje dorosłych i mieszane wzrosty może dostać bezpieczny podział", () => {
  const plan = buildUniversalPlan(profile({
    splitPolicy: "often",
    members: [adult("a1"), adult("a2"), child("c1", 15, 145), child("c2", 6, 120)],
    preferences: { intensity: "thrill", interests: ["coasters"], wet: "ok", maxQueue: 90 },
  }));
  const split = plan.days.flatMap((day) => day.steps).find((step) => step.kind === "split");
  assert.ok(split);
  assert.equal(split.assignments.length, 2);
  assert.ok(split.reunion.time);
  assert.equal(validatePlanSafety(plan).valid, true);
});

test("splitPolicy never wyłącza podziały", () => {
  const plan = buildUniversalPlan(profile({
    splitPolicy: "never",
    members: [adult("a1"), adult("a2"), child("c1", 15, 145), child("c2", 6, 120)],
    preferences: { intensity: "thrill", interests: ["coasters"], wet: "ok", maxQueue: 90 },
  }));
  assert.equal(plan.days.flatMap((day) => day.steps).some((step) => step.kind === "split"), false);
});

test("plany 1–3 dni są unikalne i mają najwyżej jeden obiad dziennie", () => {
  for (const dayCount of [1, 2, 3]) {
    const plan = buildUniversalPlan(profile({ dayCount }));
    assert.equal(plan.days.length, dayCount);
    const attractionIds = plan.days.flatMap((day) => day.steps.flatMap((step) => {
      if (step.kind === "ride") return [step.attractionId];
      if (step.kind === "split") return step.assignments.map((assignment) => assignment.attractionId);
      return [];
    }));
    assert.equal(new Set(attractionIds).size, attractionIds.length);
    plan.days.forEach((day) => assert.ok(day.steps.filter((step) => step.kind === "meal").length <= 1));
    plan.days.forEach((day) => {
      const flex = day.steps.filter((step) => step.kind === "flex");
      assert.ok(flex.length <= 1);
      if (flex[0]) assert.equal(flex[0].endMin, 20 * 60);
    });
    assert.equal(plan.safety.valid, true);
  }
});

test("plan kończy zadeklarowany dzień czytelnym buforem zamiast udawać pewność kolejek", () => {
  const plan = buildUniversalPlan(profile({ departureTime: "19:30" }));
  const flex = plan.days[0].steps.at(-1);
  assert.equal(flex.kind, "flex");
  assert.equal(flex.endMin, 19 * 60 + 30);
  assert.equal(plan.days[0].stats.end, "19:30");
});

test("nieprawidłowa godzina używa właściwego fallbacku", () => {
  assert.equal(timeToMinutes("", 1200), 1200);
  assert.equal(timeToMinutes("25:80", 810), 810);
  assert.equal(timeToMinutes("09:45", 0), 585);
});

test("późna deklarowana pora obiadu jest bezpiecznie mieszczona przed wyjściem", () => {
  const plan = buildUniversalPlan(profile({
    departureTime: "12:30",
    meal: { mode: "fast", time: "23:00" },
  }));
  const steps = plan.days[0].steps;
  assert.ok(steps.every((step) => step.endMin <= 12 * 60 + 30));
  assert.ok(steps.every((step, index) => index === 0 || step.startMin >= steps[index - 1].endMin));
  assert.equal(plan.safety.valid, true);
});

test("walidator odrzuca krok wszyscy bez pełnego składu i split pomijający osobę", () => {
  const valid = buildUniversalPlan(profile({
    splitPolicy: "often",
    members: [adult("a1"), adult("a2"), child("c1", 15, 145), child("c2", 6, 120)],
    preferences: { intensity: "thrill", interests: ["coasters"], wet: "ok", maxQueue: 90 },
  }));
  const rideDay = valid.days.find((day) => day.steps.some((step) => step.kind === "ride"));
  const ride = rideDay.steps.find((step) => step.kind === "ride");
  const brokenRide = structuredClone(valid);
  brokenRide.days[rideDay.day - 1].steps.find((step) => step.id === ride.id).memberIds = ["a1"];
  assert.equal(validatePlanSafety(brokenRide).valid, false);

  const splitDay = valid.days.find((day) => day.steps.some((step) => step.kind === "split"));
  const split = splitDay.steps.find((step) => step.kind === "split");
  const brokenSplit = structuredClone(valid);
  brokenSplit.days[splitDay.day - 1].steps.find((step) => step.id === split.id).assignments[1].memberIds = ["a2"];
  assert.equal(validatePlanSafety(brokenSplit).valid, false);
});

test("zamknięta atrakcja i twarde unikanie wody nie trafiają do planu", () => {
  const queueById = { hyperion: { isOpen: false, waitTime: 0 } };
  const plan = buildUniversalPlan(profile({
    members: [adult("a1"), adult("a2")],
    preferences: { intensity: "thrill", interests: ["coasters", "water"], wet: "avoid", maxQueue: 90 },
  }), { queueById });
  const ids = plan.days.flatMap((day) => day.steps.flatMap((step) => step.kind === "ride" ? [step.attractionId] : step.kind === "split" ? step.assignments.map((assignment) => assignment.attractionId) : []));
  assert.equal(ids.includes("hyperion"), false);
  assert.equal(ids.some((id) => ALL_ATTRACTIONS_BY_ID[id].wet), false);
});

test("katalog zawiera flagowe atrakcje 140+ z oficjalnym źródłem", () => {
  for (const id of ["hyperion", "zadra", "speed", "mayan", "space-booster", "space-gun", "aztec-swing", "apocalypto", "viking"]) {
    const ride = ALL_ATTRACTIONS_BY_ID[id];
    assert.ok(ride, id);
    assert.ok(ride.sourceUrl.startsWith("https://energylandia.pl/"));
    assert.equal(ride.soloHeight, 140);
  }
});
