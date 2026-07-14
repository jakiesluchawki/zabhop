import assert from "node:assert/strict";
import test from "node:test";
import {
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
