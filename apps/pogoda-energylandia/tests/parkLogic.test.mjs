import test from "node:test";
import assert from "node:assert/strict";
import { ATTRACTIONS, HEIGHT_PROFILES, TOILETS } from "../src/parkData.js";
import {
  buildRoute,
  chooseNextStop,
  distanceMeters,
  evaluateEligibility,
  findNearestToilet,
  getEligibleAttractions,
  walkingMinutes,
} from "../src/parkLogic.js";

const ride = (id) => ATTRACTIONS.find((item) => item.id === id);

test("udostępnia cztery użyteczne profile wzrostu", () => {
  assert.deepEqual(HEIGHT_PROFILES, [100, 110, 120, 130]);
});

test("rozróżnia próg wzrostu z opiekunem od progu samodzielnego", () => {
  assert.equal(evaluateEligibility(ride("honey-harbour"), { height: 99, age: 6 }).mode, "too-short");
  assert.equal(evaluateEligibility(ride("honey-harbour"), { height: 100, age: 6 }).mode, "with-guardian");
  assert.equal(evaluateEligibility(ride("honey-harbour"), { height: 120, age: 6 }).mode, "solo");
  assert.equal(evaluateEligibility(ride("rmf-dragon"), { height: 120, age: 6 }).mode, "with-guardian");
  assert.equal(evaluateEligibility(ride("rmf-dragon"), { height: 130, age: 6 }).mode, "solo");
});

test("atrakcje o regule wieku nie są błędnie odrzucane przez wzrost", () => {
  assert.equal(evaluateEligibility(ride("gold-mine"), { height: 100, age: 5 }).eligible, false);
  assert.equal(evaluateEligibility(ride("gold-mine"), { height: 100, age: 6 }).mode, "with-guardian");
  assert.equal(evaluateEligibility(ride("monster-house"), { height: 100, age: 6 }).mode, "with-guardian");
  assert.equal(evaluateEligibility(ride("monster-house"), { height: 130, age: 6 }).mode, "solo");
});

test("profile 100 i 120 cm dają różne, bezpieczne shortlisty", () => {
  const at100 = getEligibleAttractions({ height: 100, age: 6 }).map((item) => item.id);
  const at120 = getEligibleAttractions({ height: 120, age: 6 }).map((item) => item.id);
  assert.ok(at100.includes("honey-harbour"));
  assert.ok(at100.includes("gold-mine"));
  assert.ok(!at100.includes("choco-chip-creek"));
  assert.ok(!at100.includes("rmf-dragon"));
  assert.ok(at120.includes("choco-chip-creek"));
  assert.ok(at120.includes("rmf-dragon"));
  assert.ok(at120.includes("jungle-adventure"));
});

test("liczy dystans po kuli ziemskiej i czas marszu rodzinnego", () => {
  const oneLatitudeMillidegree = distanceMeters(
    { lat: 50, lon: 19.4 },
    { lat: 50.001, lon: 19.4 },
  );
  assert.ok(oneLatitudeMillidegree > 110 && oneLatitudeMillidegree < 112);
  assert.equal(walkingMinutes(0), 0);
  assert.equal(walkingMinutes(130), 2);
});

test("buduje trasę Sweet Valley → Aqualantis → Smoczy Gród → Familijna", () => {
  const route = buildRoute({
    height: 110,
    age: 6,
    completedIds: ["candy-carousel"],
  });
  const firstIndexByZone = Object.fromEntries(
    ["sweet-valley", "aqualantis", "dragon-zone", "family-zone"].map((zone) => [
      zone,
      route.findIndex((stop) => stop.zone === zone),
    ]),
  );
  assert.ok(firstIndexByZone["sweet-valley"] < firstIndexByZone.aqualantis);
  assert.ok(firstIndexByZone.aqualantis < firstIndexByZone["dragon-zone"]);
  assert.ok(firstIndexByZone["dragon-zone"] < firstIndexByZone["family-zone"]);
  assert.ok(!route.some((stop) => stop.id === "candy-carousel"));
  assert.ok(route.every((stop) => Number.isFinite(stop.distanceFromPreviousMeters)));
});

test("domyślna trasa pomija atrakcje typowo dla najmłodszych", () => {
  const route = buildRoute({ height: 110, age: 6 });
  assert.ok(!route.some((stop) => stop.id === "candy-carousel"));
});

test("wybór następnej atrakcji uwzględnia alias kolejki i status", () => {
  const position = ride("honey-harbour").location;
  const withAlias = chooseNextStop({
    position,
    height: 100,
    age: 6,
    queueById: {
      "Nacomi Honey Harbour": { minutes: 3, status: "open" },
    },
  });
  assert.equal(withAlias.id, "honey-harbour");
  assert.equal(withAlias.queueMinutes, 3);

  const afterClosure = chooseNextStop({
    position,
    height: 100,
    age: 6,
    queueById: {
      "Nacomi Honey Harbour": { minutes: 0, status: "closed" },
      "Candy Carousel": { minutes: 70, status: "open" },
      "Light Explorers": { minutes: 4, status: "open" },
    },
  });
  assert.equal(afterClosure.id, "light-explorers");
});

test("najbliższa toaleta zwraca dystans i czas dojścia", () => {
  const result = findNearestToilet({ lat: 50.00099, lon: 19.40001 });
  assert.equal(result.id, "toilet-aqualantis");
  assert.ok(result.distanceMeters < 5);
  assert.equal(result.walkingMinutes, 1);
  assert.equal(findNearestToilet(null), null);
  assert.ok(TOILETS.length >= 5);
});
