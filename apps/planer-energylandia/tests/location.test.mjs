import assert from "node:assert/strict";
import test from "node:test";
import {
  createLocationRequestState,
  geolocationFailureStatus,
  positionFromCoordinates,
  QUICK_LOCATION_OPTIONS,
  TRACKING_LOCATION_OPTIONS,
} from "../src/location.js";

test("pozycja geolokalizacji zachowuje współrzędne i dokładność", () => {
  assert.deepEqual(positionFromCoordinates({ latitude: 50.0002, longitude: 19.4067, accuracy: 17 }), {
    lat: 50.0002,
    lon: 19.4067,
    accuracy: 17,
  });
  assert.equal(positionFromCoordinates({ latitude: 91, longitude: 19.4 }), null);
  assert.equal(positionFromCoordinates({ latitude: 50, longitude: "brak" }), null);
});

test("błędy GPS rozróżniają odmowę, timeout i awarię", () => {
  assert.equal(geolocationFailureStatus({ code: 1 }), "denied");
  assert.equal(geolocationFailureStatus({ code: 3 }), "timeout");
  assert.equal(geolocationFailureStatus({ code: 2 }), "error");
});

test("pierwszy fix jest szybki, a śledzenie doprecyzowuje GPS", () => {
  assert.equal(QUICK_LOCATION_OPTIONS.enableHighAccuracy, false);
  assert.ok(QUICK_LOCATION_OPTIONS.timeout < TRACKING_LOCATION_OPTIONS.timeout);
  assert.equal(TRACKING_LOCATION_OPTIONS.enableHighAccuracy, true);
});

test("pierwszy fix otrzymany po ukryciu nie włącza GPS, a powrót ponawia świadomy pomiar", () => {
  const state = createLocationRequestState();
  const delivered = [];
  const start = () => {
    const request = state.begin();
    return (position) => { if (state.accepts(request)) delivered.push(position); };
  };
  const firstFix = start();
  assert.equal(state.setActive(false), false);
  firstFix("late background position");
  assert.deepEqual(delivered, []);
  assert.equal(state.setActive(true), true);
  const resumedFix = start();
  firstFix("old result after foreground");
  resumedFix("fresh foreground position");
  assert.deepEqual(delivered, ["fresh foreground position"]);
  assert.equal(state.setActive(true), false, "duplicate foreground notifications cannot create a second watch");
  state.cancel();
  resumedFix("result after unmount");
  assert.deepEqual(delivered, ["fresh foreground position"]);
});

test("powrót bez włączonego GPS albo po odmowie nie uruchamia lokalizacji", () => {
  const state = createLocationRequestState();
  state.setActive(false);
  assert.equal(state.setActive(true), false);
  state.begin();
  state.cancel();
  state.setActive(false);
  assert.equal(state.setActive(true), false);
});
