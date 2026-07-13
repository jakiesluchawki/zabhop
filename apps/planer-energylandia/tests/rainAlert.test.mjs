import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRainAlert, RAIN_ALERT_STATE } from "../src/rainAlert.js";

const NOW = "2026-07-13T16:00:00.000Z";
const FRESH = "2026-07-13T15:50:00.000Z";

function antistorm(values = {}) {
  return {
    m: "Wadowice",
    p_b: 0,
    t_b: 255,
    a_b: 0,
    p_o: 0,
    t_o: 255,
    a_o: 0,
    s: 0,
    ...values,
  };
}

test("fresh Antistorm without an immediate signal returns clear", () => {
  const result = evaluateRainAlert({ antistorm: antistorm(), antistormCheckedAt: FRESH, now: NOW });
  assert.equal(result.state, RAIN_ALERT_STATE.CLEAR);
  assert.equal(result.urgent, false);
  assert.equal(result.primarySource, "antistorm");
});
test("rain expected within the walk to the car returns leave-now", () => {
  const result = evaluateRainAlert({
    antistorm: antistorm({ p_o: 34, t_o: 22, a_o: 1 }),
    antistormCheckedAt: FRESH,
    now: NOW,
    carWalkMinutes: 30,
  });
  assert.equal(result.state, RAIN_ALERT_STATE.LEAVE_NOW);
  assert.equal(result.hazard, "rain");
  assert.equal(result.etaMinutes, 22);
  assert.equal(result.confidence, "nearby-nowcast");
});

test("Antistorm raw signal over 10 is significant and is not treated as a percent", () => {
  const result = evaluateRainAlert({
    antistorm: antistorm({ p_o: 11, t_o: 29 }),
    antistormCheckedAt: FRESH,
    now: NOW,
  });
  assert.equal(result.state, RAIN_ALERT_STATE.LEAVE_NOW);
  assert.equal(result.evidence[0].rawScale, "0-255");
});

test("rain with ETA zero returns raining", () => {
  const result = evaluateRainAlert({
    antistorm: antistorm({ p_o: 255, t_o: 0, a_o: 1 }),
    antistormCheckedAt: FRESH,
    now: NOW,
  });
  assert.equal(result.state, RAIN_ALERT_STATE.RAINING);
  assert.equal(result.etaMinutes, 0);
  assert.equal(result.reason, "rain-ongoing");
});

test("imminent storm is an urgent leave-now hazard even without a rain ETA", () => {
  const result = evaluateRainAlert({
    antistorm: antistorm({ p_b: 34, t_b: 7, a_b: 1 }),
    antistormCheckedAt: FRESH,
    now: NOW,
  });
  assert.equal(result.state, RAIN_ALERT_STATE.LEAVE_NOW);
  assert.equal(result.hazard, "storm");
  assert.equal(result.etaMinutes, 7);
});

test("storm overhead tells visitors to shelter instead of walking to the car", () => {
  const result = evaluateRainAlert({
    antistorm: antistorm({ p_b: 255, t_b: 255, a_b: 1, s: 1 }),
    antistormCheckedAt: FRESH,
    now: NOW,
  });
  assert.equal(result.state, RAIN_ALERT_STATE.SHELTER_NOW);
  assert.equal(result.urgent, true);
  assert.equal(result.hazard, "storm");
  assert.equal(result.etaMinutes, 0);
  assert.equal(result.reason, "storm-overhead");
});

test("storm overhead keeps the shelter instruction even when rain is already ongoing", () => {
  const result = evaluateRainAlert({
    antistorm: antistorm({ p_b: 255, a_b: 1, s: 1, p_o: 255, t_o: 0, a_o: 1 }),
    antistormCheckedAt: FRESH,
    now: NOW,
  });
  assert.equal(result.state, RAIN_ALERT_STATE.SHELTER_NOW);
  assert.equal(result.hazard, "storm");
  assert.equal(result.reason, "storm-overhead");
});

test("storm arriving now also tells visitors to shelter, while a seven-minute warning still means leave now", () => {
  const arrivingNow = evaluateRainAlert({
    antistorm: antistorm({ p_b: 34, t_b: 0, a_b: 1 }),
    antistormCheckedAt: FRESH,
    now: NOW,
  });
  const stillApproaching = evaluateRainAlert({
    antistorm: antistorm({ p_b: 34, t_b: 7, a_b: 1 }),
    antistormCheckedAt: FRESH,
    now: NOW,
  });
  assert.equal(arrivingNow.state, RAIN_ALERT_STATE.SHELTER_NOW);
  assert.equal(arrivingNow.reason, "storm-arriving-now");
  assert.equal(stillApproaching.state, RAIN_ALERT_STATE.LEAVE_NOW);
  assert.equal(stillApproaching.etaMinutes, 7);
});

test("a signal farther away than the car walk stays clear but retains ETA", () => {
  const result = evaluateRainAlert({
    antistorm: antistorm({ p_o: 120, t_o: 55, a_o: 1 }),
    antistormCheckedAt: FRESH,
    now: NOW,
  });
  assert.equal(result.state, RAIN_ALERT_STATE.CLEAR);
  assert.equal(result.reason, "outside-car-walk-window");
  assert.equal(result.etaMinutes, 55);
});

test("stale nowcast never claims that conditions are clear", () => {
  const result = evaluateRainAlert({
    antistorm: antistorm({ p_o: 255, t_o: 0, a_o: 1 }),
    antistormCheckedAt: "2026-07-13T15:10:00.000Z",
    now: NOW,
  });
  assert.equal(result.state, RAIN_ALERT_STATE.UNAVAILABLE);
  assert.equal(result.reason, "stale");
  assert.equal(result.evidence[0].freshness.ageMinutes, 50);
});

test("missing nowcast returns unavailable", () => {
  const result = evaluateRainAlert({ now: NOW });
  assert.equal(result.state, RAIN_ALERT_STATE.UNAVAILABLE);
  assert.equal(result.reason, "missing");
});

test("fresh 15-minute model point can trigger leave-now when Antistorm is unavailable", () => {
  const result = evaluateRainAlert({
    minutely: [
      { time: "2026-07-13T16:00:00.000Z", precipitation: 0 },
      { time: "2026-07-13T16:15:00.000Z", precipitation: 0.3 },
    ],
    minutelyCheckedAt: FRESH,
    now: NOW,
  });
  assert.equal(result.state, RAIN_ALERT_STATE.LEAVE_NOW);
  assert.equal(result.primarySource, "open-meteo-minutely-15");
  assert.equal(result.etaMinutes, 15);
  assert.equal(result.confidence, "model-nowcast");
});

test("wet current 15-minute interval returns raining", () => {
  const result = evaluateRainAlert({
    minutely: [{ time: NOW, rain: 0.2 }],
    minutelyCheckedAt: FRESH,
    now: NOW,
  });
  assert.equal(result.state, RAIN_ALERT_STATE.RAINING);
});

test("hourly precipitation remains context and cannot masquerade as a 30-minute nowcast", () => {
  const result = evaluateRainAlert({
    hours: [{ hour: 18, precipitation: 4, precipProbability: 95 }],
    now: NOW,
  });
  assert.equal(result.state, RAIN_ALERT_STATE.UNAVAILABLE);
  assert.equal(result.hourlyContext.maxProbability, 95);
  assert.match(result.hourlyContext.note, /nie potwierdza/);
});
