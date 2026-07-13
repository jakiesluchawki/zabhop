import test from "node:test";
import assert from "node:assert/strict";
import { buildUniversalPlan } from "../src/planner.js";
import { createEmailDraftUrl, decodePlan, encodePlan, sanitizeSharedPlan } from "../src/share.js";

const profile = {
  dayCount: 2,
  arrivalTime: "10:00",
  departureTime: "20:00",
  pace: "normal",
  splitPolicy: "worthwhile",
  members: [
    { id: "a1", role: "adult", name: "A", age: 35, height: 180 },
    { id: "a2", role: "adult", name: "B", age: 34, height: 170 },
    { id: "c1", role: "child", name: "C", age: 7, height: 122 },
  ],
  preferences: { intensity: "mixed", interests: ["coasters", "family"], wet: "ok", maxQueue: 45 },
  meal: { mode: "fast", time: "13:15" },
};

test("plan przechodzi bezpieczny round-trip przez link", () => {
  const plan = buildUniversalPlan(profile);
  const decoded = decodePlan(encodePlan(plan));
  assert.ok(decoded);
  assert.equal(decoded.days.length, 2);
  assert.equal(decoded.profile.members.length, 3);
  assert.equal(decoded.safety.valid, true);
  assert.deepEqual(decoded.days.map((day) => day.steps.map((step) => step.id)), plan.days.map((day) => day.steps.map((step) => step.id)));
});

test("uszkodzony lub obcy payload jest odrzucany", () => {
  assert.equal(decodePlan("to-nie-jest-plan"), null);
  assert.equal(sanitizeSharedPlan({ version: 99, profile: {}, days: [] }), null);
  assert.equal(sanitizeSharedPlan({ version: 1, profile, days: [] }), null);
});

test("import bezpiecznie odrzuca null i kolekcje o złym typie", () => {
  const plan = buildUniversalPlan(profile);
  const variants = [
    null,
    { ...plan, days: null },
    { ...plan, days: "Dzień 1" },
    { ...plan, profile: { ...plan.profile, members: null } },
    { ...plan, days: [null] },
    { ...plan, days: [{ steps: null }] },
    { ...plan, days: [{ steps: {} }] },
  ];
  variants.forEach((variant) => {
    assert.doesNotThrow(() => sanitizeSharedPlan(variant));
    assert.equal(sanitizeSharedPlan(variant), null);
  });
});

test("import nie pomija uszkodzonych kroków i odrzuca niesensowne godziny", () => {
  const plan = buildUniversalPlan(profile);
  const malformed = structuredClone(plan);
  malformed.days[0].steps[0] = null;
  assert.equal(sanitizeSharedPlan(malformed), null);

  const outsideVisit = structuredClone(plan);
  outsideVisit.days[0].steps[0].startMin = 9 * 60;
  assert.equal(sanitizeSharedPlan(outsideVisit), null);

  const backwards = structuredClone(plan);
  backwards.days[0].steps[0].endMin = backwards.days[0].steps[0].startMin;
  assert.equal(sanitizeSharedPlan(backwards), null);

  const flexBeforeRide = structuredClone(plan);
  const flexDay = flexBeforeRide.days.find((day) => day.steps.some((step) => step.kind === "flex"));
  const flexIndex = flexDay.steps.findIndex((step) => step.kind === "flex");
  [flexDay.steps[flexIndex], flexDay.steps[flexIndex - 1]] = [flexDay.steps[flexIndex - 1], flexDay.steps[flexIndex]];
  assert.equal(sanitizeSharedPlan(flexBeforeRide), null);
});

test("import nie ucina po cichu nadmiarowych przydziałów podziału", () => {
  const plan = buildUniversalPlan(profile);
  const forged = structuredClone(plan);
  const split = forged.days.flatMap((day) => day.steps).find((step) => step.kind === "split");
  assert.ok(split);
  split.assignments.push(structuredClone(split.assignments[0]));
  assert.equal(sanitizeSharedPlan(forged), null);
});

test("import odrzuca atrakcję powtórzoną w planie", () => {
  const plan = buildUniversalPlan(profile);
  const duplicate = structuredClone(plan);
  const rides = duplicate.days.flatMap((day) => day.steps).filter((step) => step.kind === "ride");
  assert.ok(rides.length >= 2);
  rides[1].attractionId = rides[0].attractionId;
  assert.equal(sanitizeSharedPlan(duplicate), null);
});

test("bezpieczne wartości domyślne naprawiają metadane, ale nie odwrócone godziny wizyty", () => {
  const plan = buildUniversalPlan(profile);
  const fallback = structuredClone(plan);
  fallback.profile.arrivalTime = "jutro";
  fallback.profile.departureTime = null;
  fallback.profile.meal.time = "23:30";
  const sanitized = sanitizeSharedPlan(fallback);
  assert.ok(sanitized);
  assert.equal(sanitized.profile.arrivalTime, "10:00");
  assert.equal(sanitized.profile.departureTime, "20:00");
  assert.equal(sanitized.profile.meal.time, "15:00");

  const reversed = structuredClone(plan);
  reversed.profile.arrivalTime = "20:00";
  reversed.profile.departureTime = "10:00";
  assert.equal(sanitizeSharedPlan(reversed), null);
});

test("adres e-mail nie należy do snapshotu planu", () => {
  const plan = buildUniversalPlan(profile);
  assert.equal(JSON.stringify(plan).includes("@"), false);
});

test("link anonimizuje nazwy i ID, zachowując dane wymagane do kontroli bezpieczeństwa", () => {
  const plan = buildUniversalPlan(profile);
  plan.profile.members[0].name = "Bardzo Tajne Imię";
  plan.profile.members[1].name = "Drugi Prywatny Uczestnik";
  const payload = encodePlan(plan);
  const rawSnapshot = Buffer.from(payload, "base64url").toString("utf8");
  assert.equal(rawSnapshot.includes("Bardzo Tajne Imię"), false);
  assert.equal(rawSnapshot.includes("Drugi Prywatny Uczestnik"), false);

  const decoded = decodePlan(payload);
  assert.ok(decoded);
  assert.deepEqual(decoded.profile.members.map((member) => member.name), ["Dorosły 1", "Dorosły 2", "Dziecko 1"]);
  assert.deepEqual(decoded.profile.members.map((member) => member.id), ["adult-1", "adult-2", "child-1"]);
  assert.deepEqual(decoded.profile.members.map(({ age, height }) => ({ age, height })), profile.members.map(({ age, height }) => ({ age, height })));
  assert.equal(decoded.safety.valid, true);
});

test("import odrzuca duplikaty uczestników i ponownie liczy statystyki", () => {
  const plan = buildUniversalPlan(profile);
  const duplicate = structuredClone(plan);
  duplicate.profile.members[1].id = duplicate.profile.members[0].id;
  assert.equal(sanitizeSharedPlan(duplicate), null);

  const forgedStats = structuredClone(plan);
  forgedStats.days[0].stats = { start: {}, end: [], walkingMinutes: "nieskończoność" };
  const sanitized = sanitizeSharedPlan(forgedStats);
  assert.ok(sanitized);
  assert.equal(typeof sanitized.days[0].stats.start, "string");
  assert.equal(typeof sanitized.days[0].stats.walkingMinutes, "number");
});

test("szkic e-maila zawiera rozpiskę bez wielotysięcznego hasha planu", () => {
  const plan = buildUniversalPlan(profile);
  const longPlanUrl = `https://example.com/planer/#plan=${encodePlan(plan)}`;
  const draft = createEmailDraftUrl("rodzina@example.com", longPlanUrl, plan);
  assert.ok(draft.startsWith("mailto:rodzina%40example.com"));
  assert.ok(decodeURIComponent(draft).includes("Dzień 1"));
  assert.equal(decodeURIComponent(draft).includes("#plan="), false);
  assert.ok(draft.length < 7000);
});
