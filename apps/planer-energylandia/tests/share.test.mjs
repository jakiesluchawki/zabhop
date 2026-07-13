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

test("adres e-mail nie należy do snapshotu planu", () => {
  const plan = buildUniversalPlan(profile);
  assert.equal(JSON.stringify(plan).includes("@"), false);
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
