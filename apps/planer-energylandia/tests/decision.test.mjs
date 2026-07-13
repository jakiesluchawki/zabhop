import test from "node:test";
import assert from "node:assert/strict";
import { chooseRecommendation, evaluateWindow } from "../src/decision.js";

function hours(values = {}) {
  return Array.from({ length: 5 }, (_, index) => ({
    hour: 10 + index,
    precipitation: 0,
    precipProbability: 10,
    thunderProbability: 0,
    gust: 20,
    temperature: 22,
    providerClasses: [0, 0],
    ...values,
  }));
}

const normal = { icmAvailable: true, numericSourceCount: 2 };
const NOWCAST_NOW = "2026-07-13T16:00:00.000Z";
const NOWCAST_FRESH = "2026-07-13T15:50:00.000Z";

test("idealna pogoda daje pozytywny, ale ostrożny werdykt przy dwóch źródłach liczbowych", () => {
  const result = evaluateWindow(hours(), normal);
  assert.equal(result.score, 85);
  assert.equal(result.label, "RACZEJ JEDŹ");
  assert.equal(result.bestWindow.start, 10);
});

test("trzy źródła liczbowe i ICM pozwalają na wysoką pewność", () => {
  const result = evaluateWindow(hours(), { icmAvailable: true, numericSourceCount: 3 });
  assert.equal(result.score, 100);
  assert.equal(result.label, "JEDŹ");
  assert.equal(result.confidence, "wysoka");
});

test("ulewa przez całe okno ogranicza wynik poniżej 40", () => {
  const result = evaluateWindow(hours({ precipitation: 3.5, precipProbability: 90, providerClasses: [3, 3] }), normal);
  assert.ok(result.score <= 39);
  assert.equal(result.label, "NIE JEDŹ");
});

test("silny wiatr ogranicza wynik", () => {
  const result = evaluateWindow(hours({ gust: 70 }), normal);
  assert.ok(result.score <= 44);
});

test("brak ICM obniża pewność i ogranicza wynik", () => {
  const result = evaluateWindow(hours(), { icmAvailable: false, numericSourceCount: 2 });
  assert.equal(result.confidence, "niska");
  assert.ok(result.score <= 69);
  assert.ok(result.reasons.some((reason) => reason.includes("ICM")));
});

test("alarm Antistorm ma pierwszeństwo dla wyjazdu teraz", () => {
  const result = evaluateWindow(hours(), {
    ...normal,
    applyAntistorm: true,
    now: NOWCAST_NOW,
    antistorm: { p_b: 80, t_b: 25, p_o: 100, t_o: 20, updatedAt: NOWCAST_FRESH },
  });
  assert.equal(result.score, 15);
  assert.equal(result.antistormStatus, "czerwony");
});

test("Antistorm nie traktuje ilości opadu jak alarmu burzowego", () => {
  const result = evaluateWindow(hours(), {
    ...normal,
    applyAntistorm: true,
    now: NOWCAST_NOW,
    antistorm: { p_b: 0, t_b: 255, a_b: 12, p_o: 0, t_o: 255, a_o: 8, s: 4, updatedAt: NOWCAST_FRESH },
  });
  assert.equal(result.antistormStatus, "zielony");
  assert.equal(result.score, 85);
});

test("wybierane jest najlepsze ciągłe okno", () => {
  const day = Array.from({ length: 10 }, (_, index) => ({
    hour: 10 + index,
    precipitation: index < 5 ? 0 : 2,
    precipProbability: index < 5 ? 10 : 85,
    thunderProbability: 0,
    gust: 20,
    temperature: 20,
    providerClasses: index < 5 ? [0, 0] : [2, 2],
  }));
  const result = chooseRecommendation(day, normal);
  assert.deepEqual(result.bestWindow, { start: 10, end: 15 });
});

test("dzisiejszy werdykt nie proponuje godzin, które już minęły", () => {
  const day = Array.from({ length: 10 }, (_, index) => ({
    ...hours()[0],
    hour: 10 + index,
  }));
  const result = chooseRecommendation(day, { ...normal, earliestStart: 18 });
  assert.equal(result.score, null);
  assert.equal(result.label, "ZA PÓŹNO");
  assert.equal(result.headline, "Na dziś już za późno.");
});

test("krótsza końcówka dnia ma konserwatywny limit wyniku", () => {
  const day = Array.from({ length: 10 }, (_, index) => ({
    ...hours()[0],
    hour: 10 + index,
  }));
  const result = chooseRecommendation(day, { ...normal, earliestStart: 16 });
  assert.equal(result.bestWindow.start, 16);
  assert.equal(result.bestWindow.end, 20);
  assert.ok(result.score <= 69);
  assert.equal(result.headline, "Jedź tylko na chwilę.");
});
