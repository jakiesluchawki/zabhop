import assert from "node:assert/strict";
import test from "node:test";
import { directionsForDay } from "../src/planDirections.js";

test("PDF pokazuje strefy, dystanse i szacowany czas, ale nie zmyśla pozycji początkowej", () => {
  const directions = directionsForDay({
    steps: [
      { id: "r1", kind: "ride", attractionId: "honey-harbour" },
      { id: "r2", kind: "ride", attractionId: "mokate-twist" },
      { id: "meal", kind: "meal", restaurantId: "napoli" },
    ],
  });

  assert.match(directions.r1.copy, /Pierwszy punkt/);
  assert.equal(directions.r1.meters, null);
  assert.equal(directions.r1.minutes, null);
  assert.ok(directions.r2.meters > 0);
  assert.ok(directions.r2.minutes >= 1);
  assert.match(directions.r2.copy, /m · około \d+ min/);
  assert.match(directions.meal.copy, /kierujcie się|zostańcie/);
});

test("każda odnoga podziału ma własne dojście z tego samego poprzedniego punktu", () => {
  const directions = directionsForDay({
    steps: [
      { id: "start", kind: "ride", attractionId: "honey-harbour" },
      {
        id: "split",
        kind: "split",
        assignments: [{ attractionId: "mokate-twist" }, { attractionId: "bumble-boats" }],
      },
      { id: "after", kind: "ride", attractionId: "bon-bon-balloon" },
    ],
  });

  assert.ok(directions["split:0"].meters > 0);
  assert.ok(directions["split:1"].meters > 0);
  assert.equal(directions["split:0"].fromLabel, directions["split:1"].fromLabel);
  assert.equal(directions.after.fromLabel, "Mokate Twist");
});

test("oficjalny pokaz bez współrzędnych ujawnia salę, lecz nie wymyśla metrów ani GPS", () => {
  const directions = directionsForDay({
    steps: [
      { id: "start", kind: "ride", attractionId: "honey-harbour" },
      { id: "show", kind: "show", title: "Aztec Show", venue: "Amfiteatr Colosseo" },
      { id: "next", kind: "ride", attractionId: "mokate-twist" },
    ],
  });

  assert.match(directions.show.copy, /Amfiteatr Colosseo/);
  assert.equal(directions.show.meters, null);
  assert.equal(directions.show.minutes, null);
  assert.equal(directions.next.fromLabel, "Honey Harbour");
});

test("pokaz ze zweryfikowanymi współrzędnymi może dostać orientacyjny dystans", () => {
  const directions = directionsForDay({
    steps: [
      { id: "start", kind: "ride", attractionId: "honey-harbour" },
      {
        id: "show",
        kind: "show",
        title: "Scena oficjalna",
        zone: "sweet-valley",
        location: { lat: 50.00141, lon: 19.40372 },
      },
    ],
  });

  assert.ok(Number.isFinite(directions.show.meters));
  assert.ok(directions.show.minutes >= 1);
});

test("brak restauracji, współrzędnych albo nieznana atrakcja nie tworzy fikcyjnej trasy", () => {
  const directions = directionsForDay({
    steps: [
      { id: "unknown", kind: "ride", attractionId: "nie-ma" },
      { id: "meal", kind: "meal", restaurantId: "nie-ma" },
      { id: "show", kind: "show", title: "Bez źródła" },
      { id: "valid", kind: "ride", attractionId: "mokate-twist" },
    ],
  });

  assert.equal(directions.unknown, undefined);
  assert.equal(directions.meal, undefined);
  assert.equal(directions.show, undefined);
  assert.equal(directions.valid.meters, null);
  assert.equal(directions.valid.minutes, null);
});

test("brak planu dnia jest neutralny i nie powoduje wyjątku", () => {
  assert.deepEqual(directionsForDay(null), {});
  assert.deepEqual(directionsForDay({}), {});
});
