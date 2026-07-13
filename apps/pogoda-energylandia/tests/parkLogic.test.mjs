import test from "node:test";
import assert from "node:assert/strict";
import { ATTRACTIONS, TOILETS } from "../src/parkData.js";
import {
  FAMILY_PROFILE,
  buildRoute,
  classifyAttractionForFamily,
  chooseNextStop,
  distanceMeters,
  evaluateEligibility,
  findNearestToilet,
  getEligibleAttractions,
  walkingMinutes,
} from "../src/parkLogic.js";

const ride = (id) => ATTRACTIONS.find((item) => item.id === id);

test("udostępnia stały profil naszej rodziny", () => {
  assert.deepEqual(FAMILY_PROFILE, {
    adults: 2,
    children: 2,
    childAge: 6,
    withGuardian: true,
    safeHeightCm: 120,
    heightRange: { min: 120, max: 129 },
    heightRangeLabel: "120–129 cm",
    description: "2 dorosłych · 2 dzieci po 6 lat · 120–129 cm",
  });
});

test("klasyfikuje atrakcje 120 cm jako zielone, a łatwiejsze jako żółte", () => {
  assert.equal(classifyAttractionForFamily(ride("choco-chip-creek")), "primary");
  assert.equal(classifyAttractionForFamily(ride("abyssus")), "primary");
  assert.equal(classifyAttractionForFamily(ride("formula")), "primary");
  assert.equal(classifyAttractionForFamily(ride("anaconda")), "primary");
  assert.equal(classifyAttractionForFamily(ride("rmf-dragon")), "primary");
  assert.equal(classifyAttractionForFamily(ride("jungle-adventure")), "primary");
  assert.equal(classifyAttractionForFamily(ride("honey-harbour")), "secondary");
  assert.equal(classifyAttractionForFamily(ride("stormy-ship")), "secondary");
  assert.equal(classifyAttractionForFamily(ride("gold-mine")), "secondary");
  assert.equal(classifyAttractionForFamily(ride("candy-carousel")), "excluded");
});

test("wyklucza atrakcje niedostępne przy 120 cm i z minimum 140 cm", () => {
  const needs121 = {
    ...ride("rmf-dragon"),
    id: "needs-121",
    restrictions: { minHeightWithGuardian: 121, soloHeight: 140 },
  };
  const needs130 = {
    ...ride("rmf-dragon"),
    id: "needs-130",
    restrictions: { minHeightWithGuardian: 130, soloHeight: 140 },
  };
  const needs140 = {
    ...ride("rmf-dragon"),
    id: "needs-140",
    restrictions: { minHeightWithGuardian: 140, soloHeight: 140 },
  };

  assert.equal(classifyAttractionForFamily(needs121), "excluded");
  assert.equal(classifyAttractionForFamily(needs130), "excluded");
  assert.equal(classifyAttractionForFamily(needs140), "excluded");

  const route = buildRoute({ attractions: [ride("rmf-dragon"), needs121, needs130, needs140] });
  assert.deepEqual(route.map((stop) => stop.id), ["rmf-dragon"]);
  assert.equal(route[0].familyTier, "primary");
});

test("żółta lista dopuszcza tylko 100/110 cm albo jawną regułę wieku", () => {
  const needs115 = {
    ...ride("honey-harbour"),
    id: "needs-115",
    restrictions: { minHeightWithGuardian: 115, soloHeight: 140 },
  };
  const unrestricted = {
    ...ride("honey-harbour"),
    id: "unrestricted",
    restrictions: {},
  };

  assert.equal(classifyAttractionForFamily(needs115), "excluded");
  assert.equal(classifyAttractionForFamily(unrestricted), "excluded");
  assert.equal(classifyAttractionForFamily(ride("honey-harbour")), "secondary");
  assert.equal(classifyAttractionForFamily(ride("stormy-ship")), "secondary");
  assert.equal(classifyAttractionForFamily(ride("monster-house")), "secondary");
});

test("domyślna zielona trasa zawiera dokładnie sześć hitów od 120 cm", () => {
  const primaryIds = buildRoute()
    .filter((stop) => stop.familyTier === "primary")
    .map((stop) => stop.id);

  assert.deepEqual(primaryIds, [
    "choco-chip-creek",
    "abyssus",
    "formula",
    "anaconda",
    "rmf-dragon",
    "jungle-adventure",
  ]);
});

test("cały katalog zachowuje ścisłe znaczenie kolorów", () => {
  for (const attraction of ATTRACTIONS) {
    const tier = classifyAttractionForFamily(attraction);
    const { minHeightWithGuardian, minAgeWithGuardian } = attraction.restrictions;

    if (tier === "primary") assert.equal(minHeightWithGuardian, 120, attraction.name);
    if (tier === "secondary") {
      assert.ok(
        minHeightWithGuardian === 100
          || minHeightWithGuardian === 110
          || (minHeightWithGuardian === null && Number.isFinite(minAgeWithGuardian)),
        attraction.name,
      );
    }
  }
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

test("buduje trasę Sweet Valley → Aqualantis → Smoczy Gród → Formuła → Familijna", () => {
  const route = buildRoute({
    completedIds: ["candy-carousel"],
  });
  const firstIndexByZone = Object.fromEntries(
    ["sweet-valley", "aqualantis", "dragon-zone", "extreme-zone", "family-zone"].map((zone) => [
      zone,
      route.findIndex((stop) => stop.zone === zone),
    ]),
  );
  assert.ok(firstIndexByZone["sweet-valley"] < firstIndexByZone.aqualantis);
  assert.ok(firstIndexByZone.aqualantis < firstIndexByZone["dragon-zone"]);
  assert.ok(firstIndexByZone["dragon-zone"] < firstIndexByZone["extreme-zone"]);
  assert.ok(firstIndexByZone["extreme-zone"] < firstIndexByZone["family-zone"]);
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

test("następny przystanek silnie preferuje otwartą atrakcję primary", () => {
  const position = { lat: 50, lon: 19.4 };
  const primary = {
    ...ride("choco-chip-creek"),
    id: "primary-120",
    name: "Primary 120",
    queueAliases: [],
    location: { lat: 50.004, lon: 19.4 },
    priority: 1,
  };
  const secondary = {
    ...ride("honey-harbour"),
    id: "secondary-100",
    name: "Secondary 100",
    queueAliases: [],
    location: position,
    priority: 100,
  };

  const preferred = chooseNextStop({
    position,
    attractions: [secondary, primary],
    queueById: {
      "primary-120": { minutes: 90, status: "open" },
      "secondary-100": { minutes: 0, status: "open" },
    },
  });
  assert.equal(preferred.id, "primary-120");
  assert.equal(preferred.familyTier, "primary");

  const afterPrimaryClosure = chooseNextStop({
    position,
    attractions: [secondary, primary],
    queueById: {
      "primary-120": { minutes: 0, status: "closed" },
      "secondary-100": { minutes: 0, status: "open" },
    },
  });
  assert.equal(afterPrimaryClosure.id, "secondary-100");
  assert.equal(afterPrimaryClosure.familyTier, "secondary");
});

test("najbliższa toaleta zwraca dystans i czas dojścia", () => {
  const result = findNearestToilet({ lat: 50.00099, lon: 19.40001 });
  assert.equal(result.id, "toilet-aqualantis");
  assert.ok(result.distanceMeters < 5);
  assert.equal(result.walkingMinutes, 1);
  assert.equal(findNearestToilet(null), null);
  assert.ok(TOILETS.length >= 5);
});
