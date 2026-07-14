import assert from "node:assert/strict";
import test from "node:test";
import {
  approximateWalkingMinutes,
  ageRangeFor,
  ageRangeLabel,
  countPlanAttractions,
  distanceMeters,
  formatDistance,
  heightRangeFor,
  heightRangeLabel,
  normalizeDraftProfile,
  queueFreshness,
} from "../src/appUtils.js";

const fallback = {
  dayCount: 1,
  visitStartDate: null,
  arrivalTime: "10:00",
  departureTime: "20:00",
  pace: "normal",
  splitPolicy: "never",
  members: [{ id: "adult-1", role: "adult", name: "Dorosły 1", age: 35, height: 175 }],
  preferences: { intensity: "mixed", interests: ["family"], wet: "ok", maxQueue: 30 },
  meal: { mode: "fast", time: "13:15" },
};

test("stary lub częściowo uszkodzony szkic jest bezpiecznie normalizowany", () => {
  const profile = normalizeDraftProfile({
    dayCount: 99,
    members: [
      { id: "ten-sam", role: "child", name: "Dziecko", age: 6, height: 120 },
      { id: "ten-sam", role: "child", name: "Dziecko 2", age: 7, height: 130 },
    ],
    preferences: { interests: ["family", "obcy-tag"], maxQueue: 999 },
  }, fallback);
  assert.equal(profile.dayCount, 3);
  assert.equal(profile.members.filter((member) => member.role === "adult").length, 1);
  assert.equal(new Set(profile.members.map((member) => member.id)).size, profile.members.length);
  assert.deepEqual(profile.preferences.interests, ["family"]);
  assert.equal(profile.preferences.maxQueue, 90);
  assert.equal(profile.visitStartDate, null);

  const dated = normalizeDraftProfile({ ...fallback, visitStartDate: "2026-07-14" }, fallback);
  assert.equal(dated.visitStartDate, "2026-07-14");
  assert.equal(normalizeDraftProfile({ ...fallback, visitStartDate: "jutro" }, fallback).visitStartDate, null);

  const crowded = normalizeDraftProfile({
    members: Array.from({ length: 14 }, (_, index) => ({ id: `c-${index}`, role: "child", age: 6, height: 120 })),
  }, fallback);
  assert.equal(crowded.members.length, 14);
  assert.equal(crowded.members[0].role, "adult");
});

test("odległość GPS ma stabilny format i orientacyjny czas marszu", () => {
  const meters = distanceMeters(
    { lat: 50.00025, lon: 19.4058 },
    { location: { lat: 50.00125, lon: 19.4058 } },
  );
  assert.ok(meters > 110 && meters < 112);
  assert.equal(formatDistance(meters), "110 m");
  assert.equal(approximateWalkingMinutes(meters), 2);
  assert.equal(distanceMeters(null, {}), null);
});

test("świeżość kolejek rozróżnia migawkę aktualną i starą", () => {
  const now = Date.parse("2026-07-13T14:00:00Z");
  assert.equal(queueFreshness("2026-07-13T13:55:00Z", now).state, "fresh");
  assert.equal(queueFreshness(now - 3 * 60 * 60 * 1000, now).state, "stale");
  assert.equal(queueFreshness(null, now).state, "unknown");
});

test("licznik odróżnia bezpieczny, ale pusty plan od realnej trasy", () => {
  assert.equal(countPlanAttractions({ days: [{ steps: [{ kind: "meal" }, { kind: "flex" }] }] }), 0);
  assert.equal(countPlanAttractions({ days: [{ steps: [{ kind: "ride" }, { kind: "split", assignments: [{}, {}] }] }] }), 3);
});

test("przedziały wieku i wzrostu mapują plan na konserwatywną dolną granicę", () => {
  assert.deepEqual(ageRangeFor("child", 6), { value: 6, label: "6–7 lat" });
  assert.deepEqual(ageRangeFor("adult", 35), { value: 18, label: "18 lat lub więcej" });
  assert.deepEqual(heightRangeFor(129), { value: 120, label: "120–129 cm" });
  assert.deepEqual(heightRangeFor(195), { value: 190, label: "190–195 cm" });
  assert.equal(heightRangeLabel(121), "120–129 cm");
  assert.equal(ageRangeLabel("child", 17), "16–17 lat");

  const restored = normalizeDraftProfile({
    members: [
      { id: "adult-1", role: "adult", age: 35, height: 175 },
      { id: "child-1", role: "child", age: 7, height: 129 },
    ],
  }, fallback);
  assert.deepEqual(restored.members.map(({ age, height }) => ({ age, height })), [
    { age: 18, height: 170 },
    { age: 6, height: 120 },
  ]);
});

test("uszkodzone dane nie udają wybranego przedziału", () => {
  assert.equal(ageRangeFor("adult", 17), null);
  assert.equal(ageRangeFor("child", 18), null);
  assert.equal(heightRangeFor(49), null);
  assert.equal(heightRangeFor(231), null);
  assert.equal(heightRangeLabel(231), "nie wybrano");
});
