import test from "node:test";
import assert from "node:assert/strict";
import { ALL_ATTRACTIONS_BY_ID } from "../src/extendedData.js";
import { distanceMeters } from "../src/parkLogic.js";
import {
  attractionLabel,
  buildUniversalPlan,
  evaluateMemberEligibility,
  evaluatePartyEligibility,
  resolveOfficialVisitWindow,
  timeToMinutes,
  validatePlanSafety,
} from "../src/planner.js";

const adult = (id, height = 175) => ({ id, role: "adult", name: id, age: 35, height });
const child = (id, age, height) => ({ id, role: "child", name: id, age, height });

function profile(overrides = {}) {
  return {
    dayCount: 1,
    visitStartDate: "2026-07-14",
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

function officialCalendar(days, { checkedAt = "2026-08-31T10:00:00.000Z", status = "fresh" } = {}) {
  return {
    source: {
      url: "https://energylandia.pl/kalendarz/",
      checkedAt,
      status,
    },
    days,
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

test("etykieta atrakcji nie ukrywa dostępu dziecka z opiekunem", () => {
  assert.equal(attractionLabel(ALL_ATTRACTIONS_BY_ID.atlantis), "4–12 lat z opiekunem · 140 cm samodzielnie");
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
  const splitProfile = profile({
    splitPolicy: "often",
    members: [adult("a1"), adult("a2"), child("c1", 15, 145), child("c2", 6, 120)],
    preferences: { intensity: "thrill", interests: ["coasters"], wet: "ok", maxQueue: 90 },
  });
  const plan = buildUniversalPlan(splitProfile);
  const split = plan.days.flatMap((day) => day.steps).find((step) => step.kind === "split");
  assert.ok(split);
  assert.equal(split.assignments.length, 2);
  assert.ok(split.reunion.time);
  assert.equal(validatePlanSafety(plan).valid, true);

  const multiDay = buildUniversalPlan({ ...splitProfile, dayCount: 3 });
  assert.ok(multiDay.days.every((day) => day.steps.filter((step) => step.kind === "split").length <= 1));
  assert.equal(multiDay.safety.valid, true);
});

test("splitPolicy never wyłącza podziały", () => {
  const plan = buildUniversalPlan(profile({
    splitPolicy: "never",
    members: [adult("a1"), adult("a2"), child("c1", 15, 145), child("c2", 6, 120)],
    preferences: { intensity: "thrill", interests: ["coasters"], wet: "ok", maxQueue: 90 },
  }));
  assert.equal(plan.days.flatMap((day) => day.steps).some((step) => step.kind === "split"), false);
});

test("plany 1–3 dni są unikalne, mają twardy obiad i najwyżej jeden podział dziennie", () => {
  for (const dayCount of [1, 2, 3]) {
    const plan = buildUniversalPlan(profile({ dayCount }));
    assert.equal(plan.profile.visitStartDate, "2026-07-14");
    assert.equal(plan.days.length, dayCount);
    const attractionIds = plan.days.flatMap((day) => day.steps.flatMap((step) => {
      if (step.kind === "ride") return [step.attractionId];
      if (step.kind === "split") return step.assignments.map((assignment) => assignment.attractionId);
      return [];
    }));
    assert.equal(new Set(attractionIds).size, attractionIds.length);
    plan.days.forEach((day) => {
      assert.equal(day.steps.filter((step) => step.kind === "meal").length, 1);
      assert.ok(day.steps.filter((step) => step.kind === "split").length <= 1);
      const flex = day.steps.filter((step) => step.kind === "flex");
      assert.ok(flex.length <= 1);
      if (flex[0]) {
        const duration = flex[0].endMin - flex[0].startMin;
        assert.ok(duration >= 60 && duration <= 90);
        assert.ok(flex[0].endMin <= 20 * 60);
        assert.ok(Array.isArray(flex[0].backupAttractionIds));
        if (flex[0].endMin < 20 * 60) {
          assert.equal(flex[0].unplannedUntil, 20 * 60);
          assert.match(flex[0].description, /swobodne okno/);
        }
      }
    });
    assert.equal(plan.safety.valid, true);
  }
});

test("każdy plan 1–3 dni zachowuje pełny horyzont do zadeklarowanego wyjścia", () => {
  for (const dayCount of [1, 2, 3]) {
    const plan = buildUniversalPlan(profile({ dayCount, departureTime: "20:00" }));
    for (const day of plan.days) {
      const flex = day.steps.at(-1);
      assert.equal(flex.kind, "flex");
      assert.equal(flex.unplannedUntil ?? flex.endMin, 20 * 60);
      assert.equal(day.stats.end, "20:00");
      assert.equal(day.stats.declaredDeparture, "20:00");
      assert.ok(Array.isArray(flex.backupAttractionIds));
    }
  }
});

test("plan kończy zadeklarowany dzień czytelnym buforem zamiast udawać pewność kolejek", () => {
  const plan = buildUniversalPlan(profile({ departureTime: "19:30" }));
  const flex = plan.days[0].steps.at(-1);
  assert.equal(flex.kind, "flex");
  assert.ok(flex.endMin <= 19 * 60 + 30);
  assert.equal(flex.unplannedUntil, 19 * 60 + 30);
  assert.equal(plan.days[0].stats.end, "19:30");
});

test("krótka wizyta 10:00–12:00 ma czytelny horyzont aż do wyjścia", () => {
  const plan = buildUniversalPlan(profile({
    arrivalTime: "10:00",
    departureTime: "12:00",
    meal: { mode: "fast", time: "11:00" },
  }));
  const finalStep = plan.days[0].steps.at(-1);

  assert.equal(plan.safety.valid, true);
  assert.equal(finalStep.kind, "flex");
  assert.equal(finalStep.unplannedUntil ?? finalStep.endMin, 12 * 60);
  assert.equal(plan.days[0].stats.end, "12:00");
  assert.equal(plan.days[0].stats.declaredDeparture, "12:00");
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
  assert.equal(steps.filter((step) => step.kind === "meal").length, 1);
  assert.ok(steps.every((step) => step.endMin <= 12 * 60 + 30));
  assert.ok(steps.every((step, index) => index === 0 || step.startMin === steps[index - 1].endMin));
  assert.equal(plan.safety.valid, true);
});

test("obiad po długiej atrakcji jest bliżej wybranej pory niż zbyt wczesna przerwa", () => {
  const queueById = Object.fromEntries(Object.keys(ALL_ATTRACTIONS_BY_ID).map((id) => [
    id,
    { isOpen: true, waitTime: 90 },
  ]));
  const plan = buildUniversalPlan(profile({
    arrivalTime: "09:00",
    preferences: { intensity: "mixed", interests: ["coasters", "family"], wet: "ok", maxQueue: 90 },
  }), { queueById });
  const meal = plan.days[0].steps.find((step) => step.kind === "meal");
  const target = timeToMinutes("13:15");

  assert.ok(meal);
  assert.ok(Math.abs(meal.startMin - target) <= 30, `obiad zaczyna się o ${meal.startMin}`);
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
    splitPolicy: "often",
    members: [adult("a1"), adult("a2"), child("c1", 15, 145), child("c2", 6, 120)],
    preferences: { intensity: "thrill", interests: ["coasters", "water"], wet: "avoid", maxQueue: 90 },
  }), { queueById });
  const ids = plan.days.flatMap((day) => day.steps.flatMap((step) => step.kind === "ride" ? [step.attractionId] : step.kind === "split" ? step.assignments.map((assignment) => assignment.attractionId) : []));
  assert.equal(ids.includes("hyperion"), false);
  assert.equal(ids.some((id) => ALL_ATTRACTIONS_BY_ID[id].wet), false);
});

test("aktualna migawka może eliminować potwierdzone zamknięcie tylko dla tego samego dnia", () => {
  const now = Date.parse("2026-07-14T10:30:00.000Z");
  const queueSnapshotAt = Date.parse("2026-07-14T10:15:00.000Z");
  const queueById = {
    hyperion: { isOpen: false, waitTime: 0 },
    formula: { isOpen: true, waitTime: 10 },
  };
  const adultProfile = profile({
    members: [adult("a1"), adult("a2")],
    preferences: { intensity: "thrill", interests: ["coasters"], wet: "ok", maxQueue: 90 },
    queueSnapshotAt,
  });
  const rideIds = (plan) => plan.days[0].steps.flatMap((step) => step.kind === "ride" ? [step.attractionId] : []);

  assert.equal(rideIds(buildUniversalPlan(adultProfile, { queueById, now })).includes("hyperion"), false);

  const tomorrow = buildUniversalPlan({ ...adultProfile, visitStartDate: "2026-07-15" }, { queueById, now });
  assert.equal(rideIds(tomorrow).includes("hyperion"), true);
  assert.ok(tomorrow.days[0].steps.filter((step) => step.kind === "ride").every((step) => step.queueMinutes === null));
  assert.equal(tomorrow.safety.valid, true);
});

test("nieaktualna lub nieudatowana migawka nie wyklucza atrakcji ani nie pokazuje czasu jako live", () => {
  const now = Date.parse("2026-07-14T14:00:00.000Z");
  const queueById = {
    hyperion: { isOpen: false, waitTime: 0 },
    formula: { isOpen: true, waitTime: 90 },
  };
  const adultProfile = profile({
    members: [adult("a1"), adult("a2")],
    preferences: { intensity: "thrill", interests: ["coasters"], wet: "ok", maxQueue: 15 },
  });

  for (const queueSnapshotAt of ["2026-07-14T10:00:00.000Z", null, "nieprawidłowa data"]) {
    const plan = buildUniversalPlan({ ...adultProfile, queueSnapshotAt }, { queueById, now });
    const rides = plan.days[0].steps.filter((step) => step.kind === "ride");
    assert.equal(rides.some((step) => step.attractionId === "hyperion"), true);
    assert.equal(rides.some((step) => step.attractionId === "formula"), true);
    assert.ok(rides.every((step) => step.queueMinutes === null));
    assert.equal(plan.safety.valid, true);
  }
});

test("nieznany status i pojedyncze stare wpisy nie udają pewnego zamknięcia ani kolejki", () => {
  const queueById = {
    hyperion: { isOpen: null, waitTime: 0 },
    formula: { isOpen: false, waitTime: 90, stale: true },
  };
  const plan = buildUniversalPlan(profile({
    members: [adult("a1"), adult("a2")],
    preferences: { intensity: "thrill", interests: ["coasters"], wet: "ok", maxQueue: 15 },
  }), { queueById });
  const rides = plan.days[0].steps.filter((step) => step.kind === "ride");

  assert.equal(rides.some((step) => step.attractionId === "hyperion"), true);
  assert.equal(rides.some((step) => step.attractionId === "formula"), true);
  assert.equal(rides.find((step) => step.attractionId === "hyperion").queueMinutes, null);
  assert.equal(rides.find((step) => step.attractionId === "formula").queueMinutes, null);
  assert.equal(plan.safety.valid, true);
});

test("wiarygodny GPS w dniu wizyty skraca dojście do pierwszej bezpiecznej atrakcji", () => {
  const now = Date.parse("2026-07-14T10:00:00.000Z");
  const energus = ALL_ATTRACTIONS_BY_ID.energus;
  const position = { lat: energus.location.lat + 0.00018, lon: energus.location.lon, accuracy: 18 };
  const baseline = buildUniversalPlan(profile(), { now });
  const nearby = buildUniversalPlan(profile(), { now, currentPosition: position });
  const firstBaseline = ALL_ATTRACTIONS_BY_ID[baseline.firstAttractionId];
  const firstNearby = ALL_ATTRACTIONS_BY_ID[nearby.firstAttractionId];
  const firstStep = nearby.days[0].steps.find((step) => step.kind === "ride");

  assert.ok(distanceMeters(position, firstNearby) + 200 < distanceMeters(position, firstBaseline));
  assert.ok(firstStep.walkingMinutes >= 1);
  assert.ok(nearby.days[0].stats.walkingMinutes >= firstStep.walkingMinutes);
  assert.equal(nearby.safety.valid, true);
});

test("GPS nie omija wzrostu, opiekuna, zamknięcia ani twardego limitu kolejki", () => {
  const now = Date.parse("2026-07-14T10:00:00.000Z");
  const energus = ALL_ATTRACTIONS_BY_ID.energus;
  const hyperion = ALL_ATTRACTIONS_BY_ID.hyperion;
  const queueById = {
    energus: { isOpen: false, waitTime: 0 },
    "frutti-loop": { isOpen: true, waitTime: 75 },
    formula: { isOpen: true, waitTime: 10 },
  };
  const plan = buildUniversalPlan(profile({
    preferences: { intensity: "mixed", interests: ["coasters", "family"], wet: "ok", maxQueue: 15 },
  }), {
    queueById,
    now,
    currentPosition: { lat: hyperion.location.lat, lon: hyperion.location.lon, accuracy: 12 },
  });
  const rideIds = plan.days[0].steps.flatMap((step) => step.kind === "ride" ? [step.attractionId] : []);

  assert.equal(rideIds.includes("hyperion"), false);
  assert.equal(rideIds.includes("energus"), false);
  assert.equal(rideIds.includes("frutti-loop"), false);
  assert.equal(plan.safety.valid, true);
  assert.ok(distanceMeters(energus, ALL_ATTRACTIONS_BY_ID[plan.firstAttractionId]) < 2_000);
});

test("słaby GPS, pozycja poza parkiem oraz plan na inny dzień zachowują dotychczasową trasę", () => {
  const now = Date.parse("2026-07-14T10:00:00.000Z");
  const energus = ALL_ATTRACTIONS_BY_ID.energus;
  const rideIds = (plan) => plan.days[0].steps.flatMap((step) => step.kind === "ride" ? [step.attractionId] : []);
  const currentProfile = profile();
  const expected = rideIds(buildUniversalPlan(currentProfile, { now }));
  const rejectedPositions = [
    { ...energus.location, accuracy: 151 },
    { ...energus.location, accuracy: null },
    { lat: 52.2297, lon: 21.0122, accuracy: 8 },
    { lat: 91, lon: energus.location.lon, accuracy: 8 },
  ];

  for (const currentPosition of rejectedPositions) {
    assert.deepEqual(rideIds(buildUniversalPlan(currentProfile, { now, currentPosition })), expected);
  }

  const futureProfile = { ...currentProfile, visitStartDate: "2026-07-15" };
  const futureBaseline = buildUniversalPlan(futureProfile, { now });
  const futureWithGps = buildUniversalPlan(futureProfile, {
    now,
    currentPosition: { ...energus.location, accuracy: 10 },
  });
  assert.deepEqual(rideIds(futureWithGps), rideIds(futureBaseline));
  assert.equal(futureWithGps.days[0].stats.walkingMinutes, futureBaseline.days[0].stats.walkingMinutes);
});

test("oficjalne godziny 10:00–18:00 ograniczają cały plan i zachowują kompatybilny horyzont", () => {
  const now = Date.parse("2026-08-31T10:30:00.000Z");
  const parkCalendar = officialCalendar({
    "2026-09-01": { date: "2026-09-01", status: "open", opensAt: "10:00", closesAt: "18:00", shows: [] },
  });
  const requested = profile({ visitStartDate: "2026-09-01", arrivalTime: "09:00", departureTime: "20:00" });
  const window = resolveOfficialVisitWindow(requested, parkCalendar, { now });
  const plan = buildUniversalPlan(requested, { parkCalendar, now });

  assert.equal(window.state, "confirmed");
  assert.equal(window.arrivalTime, "10:00");
  assert.equal(window.departureTime, "18:00");
  assert.equal(window.officialOpensAt, "10:00");
  assert.equal(window.officialClosesAt, "18:00");
  assert.equal(plan.profile.arrivalTime, "10:00");
  assert.equal(plan.profile.departureTime, "18:00");
  assert.equal(plan.days[0].stats.start, "10:00");
  assert.equal(plan.days[0].stats.end, "18:00");
  assert.ok(plan.days[0].steps.every((step) => step.startMin >= 10 * 60 && step.endMin <= 18 * 60));
  assert.equal(plan.safety.valid, true);
});

test("wielodniowy plan stosuje konserwatywne przecięcie potwierdzonych godzin bez psucia linków", () => {
  const now = Date.parse("2026-08-31T10:30:00.000Z");
  const parkCalendar = officialCalendar({
    "2026-09-01": { date: "2026-09-01", status: "open", opensAt: "10:00", closesAt: "20:00", shows: [] },
    "2026-09-02": { date: "2026-09-02", status: "open", opensAt: "11:00", closesAt: "18:00", shows: [] },
  });
  const plan = buildUniversalPlan(profile({ dayCount: 2, visitStartDate: "2026-09-01" }), { parkCalendar, now });

  assert.equal(plan.profile.arrivalTime, "11:00");
  assert.equal(plan.profile.departureTime, "18:00");
  assert.ok(plan.days.every((day) => day.stats.start === "11:00" && day.stats.end === "18:00"));
  assert.ok(plan.days.every((day) => day.steps.at(-1).unplannedUntil === 18 * 60 || day.steps.at(-1).endMin === 18 * 60));
  assert.equal(plan.safety.valid, true);
});

test("potwierdzone zamknięcie albo okno poza godzinami nie sugeruje żadnej wizyty", () => {
  const now = Date.parse("2026-08-31T10:30:00.000Z");
  const closedCalendar = officialCalendar({
    "2026-09-01": { date: "2026-09-01", status: "closed", opensAt: null, closesAt: null, shows: [] },
  });
  const closed = buildUniversalPlan(profile({ visitStartDate: "2026-09-01" }), { parkCalendar: closedCalendar, now });

  assert.equal(closed.firstAttractionId, null);
  assert.equal(closed.days[0].steps.length, 0);
  assert.equal(closed.safety.valid, false);
  assert.match(closed.safety.issues[0], /zamknięty/);

  const openCalendar = officialCalendar({
    "2026-09-01": { date: "2026-09-01", status: "open", opensAt: "10:00", closesAt: "18:00", shows: [] },
  });
  const outside = buildUniversalPlan(profile({
    visitStartDate: "2026-09-01",
    arrivalTime: "19:00",
    departureTime: "20:00",
  }), { parkCalendar: openCalendar, now });
  assert.equal(outside.days[0].steps.length, 0);
  assert.equal(outside.safety.valid, false);
  assert.match(outside.safety.issues[0], /oficjalnym oknie 10:00–18:00/);
});

test("stary lub brakujący kalendarz nie udaje oficjalnego zamknięcia ani zmienionych godzin", () => {
  const now = Date.parse("2026-08-31T10:30:00.000Z");
  const staleCalendar = officialCalendar({
    "2026-09-01": { date: "2026-09-01", status: "closed", shows: [] },
  }, { checkedAt: "2026-08-20T10:00:00.000Z" });
  const requested = profile({ visitStartDate: "2026-09-01" });
  const window = resolveOfficialVisitWindow(requested, staleCalendar, { now });
  const plan = buildUniversalPlan(requested, { parkCalendar: staleCalendar, now });

  assert.equal(window.state, "assumed");
  assert.equal(window.days[0].state, "unknown");
  assert.equal(plan.profile.arrivalTime, "10:00");
  assert.equal(plan.profile.departureTime, "20:00");
  assert.ok(plan.days[0].steps.some((step) => step.kind === "ride"));
  assert.equal(plan.safety.valid, true);
});

test("jednodniowy plan poza godzinami otwarcia używa neutralnej migawki zamiast pustego dnia", () => {
  const allClosed = Object.fromEntries(Object.keys(ALL_ATTRACTIONS_BY_ID).map((id) => [
    id,
    { isOpen: false, waitTime: 0 },
  ]));
  const plan = buildUniversalPlan(profile(), { queueById: allClosed });
  const rides = plan.days[0].steps.filter((step) => step.kind === "ride");

  assert.ok(rides.length > 0);
  assert.ok(rides.every((step) => step.queueMinutes === null));
  assert.ok(plan.firstAttractionId);
  assert.equal(plan.safety.valid, true);

  const mixedSnapshot = { hyperion: { isOpen: false, waitTime: 0 }, formula: { isOpen: true, waitTime: 10 } };
  const livePlan = buildUniversalPlan(profile({
    members: [adult("a1"), adult("a2")],
    preferences: { intensity: "thrill", interests: ["coasters"], wet: "ok", maxQueue: 90 },
  }), { queueById: mixedSnapshot });
  const liveIds = livePlan.days[0].steps.flatMap((step) => step.kind === "ride" ? [step.attractionId] : []);
  assert.equal(liveIds.includes("hyperion"), false);
});

test("spokojny tryb nie wybiera mocnych atrakcji do rdzenia", () => {
  const plan = buildUniversalPlan(profile({
    splitPolicy: "often",
    preferences: { intensity: "calm", interests: ["family", "scenic"], wet: "ok", maxQueue: 90 },
  }));
  const ids = plan.days.flatMap((day) => day.steps.flatMap((step) => {
    if (step.kind === "ride") return [step.attractionId];
    if (step.kind === "split") return step.assignments.map((assignment) => assignment.attractionId);
    return [];
  }));
  assert.ok(ids.length > 0);
  assert.ok(ids.every((id) => ALL_ATTRACTIONS_BY_ID[id].thrillLevel <= 2));
  assert.equal(plan.safety.valid, true);
});

test("limit kolejki jest twardy także dla alternatywy podziału", () => {
  const queueById = Object.fromEntries(Object.keys(ALL_ATTRACTIONS_BY_ID).map((id) => [id, { isOpen: true, waitTime: 60 }]));
  queueById.hyperion = { isOpen: true, waitTime: 10 };
  const plan = buildUniversalPlan(profile({
    splitPolicy: "often",
    members: [adult("a1"), adult("a2"), child("c1", 15, 145), child("c2", 6, 120)],
    preferences: { intensity: "thrill", interests: ["coasters"], wet: "ok", maxQueue: 15 },
  }), { queueById });
  assert.equal(plan.days.flatMap((day) => day.steps).some((step) => step.kind === "split"), false);
  assert.equal(plan.safety.valid, true);
});

test("dłuższa wizyta zwiększa cap planu, a bufor pozostaje kontrolowany", () => {
  const short = buildUniversalPlan(profile({ departureTime: "14:00", meal: { mode: "none", time: "13:15" } }));
  const long = buildUniversalPlan(profile({ departureTime: "20:00", meal: { mode: "none", time: "13:15" } }));
  const rideCount = (plan) => plan.days[0].steps.filter((step) => step.kind === "ride").length;
  assert.ok(rideCount(long) > rideCount(short));
  const flex = long.days[0].steps.find((step) => step.kind === "flex");
  assert.ok(flex);
  assert.ok(flex.endMin - flex.startMin >= 60 && flex.endMin - flex.startMin <= 90);
  assert.ok(flex.backupAttractionIds.length > 0);
});

test("kolejne dni używają neutralnego modelu kolejek zamiast dzisiejszych liczb", () => {
  const queueById = Object.fromEntries(Object.keys(ALL_ATTRACTIONS_BY_ID).map((id) => [id, { isOpen: true, waitTime: 10 }]));
  const plan = buildUniversalPlan(profile({ dayCount: 3 }), { queueById });
  for (const day of plan.days.slice(1)) {
    for (const step of day.steps) {
      if (step.kind === "ride") {
        assert.equal(step.queueMinutes, null);
        assert.equal(step.queueModel, "future-neutral");
      }
      if (step.kind === "split") {
        assert.equal(step.queueModel, "future-neutral");
        assert.ok(step.assignments.every((assignment) => assignment.queueMinutes === null));
      }
    }
  }
  assert.equal(plan.safety.valid, true);

  const highToday = { hyperion: { isOpen: true, waitTime: 60 } };
  const futurePlan = buildUniversalPlan(profile({
    dayCount: 2,
    members: [adult("a1"), adult("a2")],
    preferences: { intensity: "thrill", interests: ["coasters"], wet: "ok", maxQueue: 15 },
  }), { queueById: highToday });
  const rideIds = (day) => day.steps.flatMap((step) => step.kind === "ride" ? [step.attractionId] : []);
  assert.equal(rideIds(futurePlan.days[0]).includes("hyperion"), false);
  assert.equal(rideIds(futurePlan.days[1]).includes("hyperion"), true);
  const futureHyperion = futurePlan.days[1].steps.find((step) => step.attractionId === "hyperion");
  assert.equal(futureHyperion.queueMinutes, null);
  assert.equal(futureHyperion.queueModel, "future-neutral");
});

test("walidator odrzuca dzieci bez dorosłego, duplikaty kroków i nielogiczne czasy", () => {
  const childrenOnly = buildUniversalPlan(profile({ members: [child("c1", 15, 145)] }));
  assert.equal(childrenOnly.safety.valid, false);
  assert.ok(childrenOnly.safety.issues.some((issue) => issue.includes("dorosły opiekun")));

  const valid = buildUniversalPlan(profile());
  const rides = valid.days[0].steps.filter((step) => step.kind === "ride");
  assert.ok(rides.length >= 2);

  const duplicateStep = structuredClone(valid);
  duplicateStep.days[0].steps.find((step) => step.id === rides[1].id).id = rides[0].id;
  assert.equal(validatePlanSafety(duplicateStep).valid, false);

  const duplicateRide = structuredClone(valid);
  duplicateRide.days[0].steps.find((step) => step.id === rides[1].id).attractionId = rides[0].attractionId;
  assert.equal(validatePlanSafety(duplicateRide).valid, false);

  const brokenTime = structuredClone(valid);
  brokenTime.days[0].steps[1].startMin = brokenTime.days[0].steps[0].startMin;
  assert.equal(validatePlanSafety(brokenTime).valid, false);

  const truncatedHorizon = structuredClone(valid);
  const flex = truncatedHorizon.days[0].steps.at(-1);
  assert.equal(flex.kind, "flex");
  flex.unplannedUntil = null;
  assert.ok(validatePlanSafety(truncatedHorizon).issues.some((issue) => issue.includes("reszty zadeklarowanego dnia")));
});

test("walidator egzekwuje politykę podziału w całym planie", () => {
  const oftenPlan = buildUniversalPlan(profile({
    dayCount: 3,
    splitPolicy: "often",
    members: [adult("a1"), adult("a2"), child("c1", 15, 145), child("c2", 6, 120)],
    preferences: { intensity: "thrill", interests: ["coasters"], wet: "ok", maxQueue: 90 },
  }));
  assert.ok(oftenPlan.days.flatMap((day) => day.steps).filter((step) => step.kind === "split").length > 1);

  const forbidden = structuredClone(oftenPlan);
  forbidden.profile.splitPolicy = "never";
  assert.ok(validatePlanSafety(forbidden).issues.some((issue) => issue.includes("plan bez podziałów")));

  const worthwhile = structuredClone(oftenPlan);
  worthwhile.profile.splitPolicy = "worthwhile";
  assert.ok(validatePlanSafety(worthwhile).issues.some((issue) => issue.includes("całym planie")));
});

test("katalog zawiera flagowe atrakcje 140+ z oficjalnym źródłem", () => {
  for (const id of ["hyperion", "zadra", "speed", "mayan", "space-booster", "space-gun", "aztec-swing", "apocalypto", "viking"]) {
    const ride = ALL_ATTRACTIONS_BY_ID[id];
    assert.ok(ride, id);
    assert.ok(ride.sourceUrl.startsWith("https://energylandia.pl/"));
    assert.equal(ride.soloHeight, 140);
  }
});
