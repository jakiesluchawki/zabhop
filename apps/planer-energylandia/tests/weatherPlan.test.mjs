import test from "node:test";
import assert from "node:assert/strict";
import { assessThreeDayWeather, recommendVisitLength } from "../src/weatherPlan.js";
import { RAIN_ALERT_STATE } from "../src/rainAlert.js";

function day(dateKey, score, confidence = "wysoka", index = 0) {
  return { index, dateKey, recommendation: { score, confidence } };
}

function dryHours(dateKey) {
  return Array.from({ length: 10 }, (_, index) => ({
    day: dateKey,
    hour: 10 + index,
    precipitation: 0,
    precipProbability: 10,
    thunderProbability: 0,
    gust: 20,
    temperature: 22,
    providerClasses: [0, 0, 0],
  }));
}

test("trzy kompletne, dobre dni uzasadniają pobyt trzydniowy", () => {
  const result = recommendVisitLength([
    day("2026-07-13", 84, "wysoka", 0),
    day("2026-07-14", 78, "wysoka", 1),
    day("2026-07-15", 75, "średnia", 2),
  ]);

  assert.equal(result.dayCount, 3);
  assert.equal(result.status, "recommended");
  assert.deepEqual(result.selectedIndices, [0, 1, 2]);
  assert.match(result.summary, /79\/100/);
  assert.ok(result.reasons.some((reason) => reason.includes("Najsłabszy")));
});

test("wybiera najlepszą parę kolejnych dni, a nie dwa dowolne dobre dni", () => {
  const result = recommendVisitLength([
    day("2026-07-13", 91, "wysoka", 0),
    day("2026-07-14", 32, "wysoka", 1),
    day("2026-07-15", 88, "wysoka", 2),
  ]);

  assert.equal(result.dayCount, 1);
  assert.deepEqual(result.selectedIndices, [0]);
  assert.match(result.reasons[1], /Żadna para kolejnych dni/);
});

test("dwa dobre kolejne dni mogą wygrać przy braku trzeciego, ale werdykt jest warunkowy", () => {
  const result = recommendVisitLength([
    day("2026-07-13", 82, "wysoka", 0),
    day("2026-07-14", 76, "średnia", 1),
    day("2026-07-15", null, "niska", 2),
  ]);

  assert.equal(result.dayCount, 2);
  assert.equal(result.status, "conditional");
  assert.deepEqual(result.selectedDateKeys, ["2026-07-13", "2026-07-14"]);
  assert.ok(result.warnings.some((warning) => warning.includes("Brakuje")));
});

test("niska pewność blokuje wielodniową rekomendację nawet przy dobrym wyniku", () => {
  const result = recommendVisitLength([
    day("2026-07-13", 69, "niska", 0),
    day("2026-07-14", 69, "niska", 1),
    day("2026-07-15", 69, "niska", 2),
  ]);

  assert.equal(result.dayCount, 1);
  assert.equal(result.status, "conditional");
  assert.equal(result.confidence, "niska");
  assert.ok(result.warnings.some((warning) => warning.includes("Niska pewność")));
});

test("przy trzech złych dniach najwyżej jeden dzień jest jawnie oznaczony jako ryzykowny", () => {
  const result = recommendVisitLength([
    day("2026-07-13", 22, "wysoka", 0),
    day("2026-07-14", 37, "wysoka", 1),
    day("2026-07-15", 29, "wysoka", 2),
  ]);

  assert.equal(result.dayCount, 1);
  assert.equal(result.status, "avoid");
  assert.deepEqual(result.selectedIndices, [1]);
  assert.match(result.headline, /Nie rezerwuj/);
});

test("zupełny brak danych nie udaje rekomendacji jednego dnia", () => {
  const result = recommendVisitLength([
    day("2026-07-13", null, "niska", 0),
    day("2026-07-14", null, "niska", 1),
    day("2026-07-15", null, "niska", 2),
  ]);

  assert.equal(result.dayCount, null);
  assert.equal(result.status, "insufficient-data");
  assert.equal(result.score, null);
  assert.match(result.summary, /Nie kupuj/);
});

test("pełna ocena oddziela alarm Antistorm od prognozy dnia i wybiera bezpieczniejszy ciąg", () => {
  const now = new Date("2026-07-13T08:30:00.000Z");
  const weather = {
    today: "2026-07-13",
    tomorrow: "2026-07-14",
    dayAfterTomorrow: "2026-07-15",
    days: {
      "2026-07-13": dryHours("2026-07-13"),
      "2026-07-14": dryHours("2026-07-14"),
      "2026-07-15": dryHours("2026-07-15"),
    },
    icm: { updatedAt: "2026-07-13T02:00:00.000Z" },
    numericSourceCount: 3,
    antistorm: {
      m: "Wadowice",
      p_o: 34,
      t_o: 20,
      a_o: 1,
      p_b: 0,
      t_b: 255,
      a_b: 0,
      s: 0,
      updatedAt: "2026-07-13T08:25:00.000Z",
    },
  };

  const result = assessThreeDayWeather(weather, { now });

  assert.equal(result.days.length, 3);
  assert.equal(result.days[0].recommendation.antistormStatus, "czerwony");
  assert.equal(result.rainAlert.state, RAIN_ALERT_STATE.LEAVE_NOW);
  assert.equal(result.rainAlert.etaMinutes, 20);
  assert.equal(result.visit.dayCount, 2);
  assert.deepEqual(result.visit.selectedIndices, [1, 2]);
});

test("brak klucza dzisiejszego dnia nie przesuwa tomorrow do roli live nowcast", () => {
  const weather = {
    today: null,
    tomorrow: "2026-07-14",
    dayAfterTomorrow: "2026-07-15",
    days: {
      "2026-07-14": dryHours("2026-07-14"),
      "2026-07-15": dryHours("2026-07-15"),
    },
    icm: { updatedAt: "2026-07-13T02:00:00.000Z" },
    numericSourceCount: 3,
    antistorm: {
      p_o: 34,
      t_o: 20,
      a_o: 1,
      p_b: 0,
      t_b: 255,
      a_b: 0,
      s: 0,
      updatedAt: "2026-07-13T08:25:00.000Z",
    },
  };

  const result = assessThreeDayWeather(weather, { now: new Date("2026-07-13T08:30:00.000Z") });

  assert.equal(result.days.length, 3);
  assert.equal(result.days[0].dateKey, null);
  assert.equal(result.days[0].recommendation.score, null);
  assert.equal(result.days[1].recommendation.antistormStatus, "zielony");
  assert.equal(result.visit.dayCount, 2);
  assert.deepEqual(result.visit.selectedIndices, [1, 2]);
});
