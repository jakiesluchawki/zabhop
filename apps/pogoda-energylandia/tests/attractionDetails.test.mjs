import test from "node:test";
import assert from "node:assert/strict";
import { ATTRACTION_DETAILS, detailsForAttraction } from "../src/attractionDetails.js";
import { ATTRACTIONS } from "../src/parkData.js";

test("każda atrakcja z rodzinnej trasy ma opis i oficjalne zdjęcie", () => {
  assert.equal(Object.keys(ATTRACTION_DETAILS).length, ATTRACTIONS.length);

  for (const attraction of ATTRACTIONS) {
    const details = detailsForAttraction(attraction);
    assert.ok(details.summary.length >= 70, `${attraction.name}: zbyt krótki opis`);
    assert.equal(
      new URL(details.imageUrl).hostname,
      "energylandia.pl",
      `${attraction.name}: zdjęcie nie pochodzi z oficjalnej domeny`,
    );
  }
});

test("brakująca atrakcja dostaje bezpieczny opis zastępczy", () => {
  const details = detailsForAttraction({ id: "nieznana" });
  assert.equal(details.imageUrl, null);
  assert.match(details.summary, /komunikaty obsługi/);
});
