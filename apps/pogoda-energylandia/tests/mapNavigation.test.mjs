import test from "node:test";
import assert from "node:assert/strict";
import { createWalkingMapLinks } from "../src/mapNavigation.js";

test("tworzy piesze linki do Apple Maps i Google Maps bez narzuconego początku", () => {
  const links = createWalkingMapLinks({
    name: "Choco Chip Creek",
    location: { lat: 50.0001719, lon: 19.4028551 },
  });

  assert.equal(links.destinationName, "Choco Chip Creek");

  const apple = new URL(links.appleMapsUrl);
  assert.equal(apple.origin, "https://maps.apple.com");
  assert.equal(apple.searchParams.get("daddr"), "50.0001719,19.4028551");
  assert.equal(apple.searchParams.get("q"), "Choco Chip Creek");
  assert.equal(apple.searchParams.get("dirflg"), "w");
  assert.equal(apple.searchParams.has("saddr"), false);

  const google = new URL(links.googleMapsUrl);
  assert.equal(google.origin, "https://www.google.com");
  assert.equal(google.pathname, "/maps/dir/");
  assert.equal(google.searchParams.get("api"), "1");
  assert.equal(google.searchParams.get("destination"), "50.0001719,19.4028551");
  assert.equal(google.searchParams.get("travelmode"), "walking");
  assert.equal(google.searchParams.has("origin"), false);
});

test("obsługuje współrzędną location.lng i bezpiecznie koduje nazwę", () => {
  const links = createWalkingMapLinks({
    name: "Formuła & Przyjaciele",
    location: { lat: "49.9995868", lng: "19.4056038" },
  });

  assert.equal(new URL(links.appleMapsUrl).searchParams.get("q"), "Formuła & Przyjaciele");
  assert.equal(
    new URL(links.googleMapsUrl).searchParams.get("destination"),
    "49.9995868,19.4056038",
  );
});

test("zwraca null, gdy atrakcja nie ma poprawnych współrzędnych", () => {
  assert.equal(createWalkingMapLinks({ name: "Bez lokalizacji" }), null);
  assert.equal(createWalkingMapLinks({ name: "Brak długości", location: { lat: 50 } }), null);
  assert.equal(
    createWalkingMapLinks({ name: "Poza globem", location: { lat: 120, lon: 19.4 } }),
    null,
  );
});
