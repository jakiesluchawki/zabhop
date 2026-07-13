import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateTicketCost,
  compareVisitLengths,
  getDialCondition,
  ticketPricesFor,
} from "../src/trip.js";

test("lipiec używa oficjalnego cennika e-biletów sezonu wysokiego", () => {
  const prices = ticketPricesFor("2026-07-13");
  assert.equal(prices.standard.oneDay, 229);
  assert.equal(prices.standard.twoDay, 419);
  assert.equal(prices.discounted.oneDay, 189);
  assert.equal(prices.discounted.twoDay, 349);
});

test("wiosna i jesień używają cennika sezonu niskiego", () => {
  assert.equal(ticketPricesFor("2026-06-20").standard.oneDay, 209);
  assert.equal(ticketPricesFor("2026-09-20").standard.twoDay, 379);
  assert.equal(ticketPricesFor("2027-07-13"), null);
});

test("kalkulator pokazuje pełny koszt rodziny i oszczędność wobec dwóch jednodniowych", () => {
  const costs = calculateTicketCost(ticketPricesFor("2026-07-13"), { standard: 1, discounted: 1 });
  assert.equal(costs.oneDay, 418);
  assert.equal(costs.twoDay, 768);
  assert.equal(costs.savings, 68);
  assert.equal(costs.secondDayExtra, 350);
});

test("dwa dobre dni uzasadniają bilet dwudniowy", () => {
  const advice = compareVisitLengths(
    { score: 86 },
    { score: 74 },
    ticketPricesFor("2026-07-13"),
    { standard: 1, discounted: 0 },
  );
  assert.equal(advice.mode, "two");
  assert.equal(advice.costs.savings, 39);
});

test("jeden wyraźnie zły dzień kieruje na bilet jednodniowy", () => {
  const advice = compareVisitLengths(
    { score: 86 },
    { score: 38 },
    ticketPricesFor("2026-07-13"),
    { standard: 1, discounted: 0 },
  );
  assert.equal(advice.mode, "one");
  assert.equal(advice.betterDay, 1);
});

test("wskaźnik rozróżnia słońce, chmury i opad", () => {
  assert.equal(getDialCondition({ metrics: { maxThunder: 0, rainTotal: 0, maxRain: 0, averageCloudCover: 20 }, hours: [] }), "sun");
  assert.equal(getDialCondition({ metrics: { maxThunder: 0, rainTotal: 0, maxRain: 0, averageCloudCover: 70 }, hours: [] }), "cloud");
  assert.equal(getDialCondition({ metrics: { maxThunder: 0, rainTotal: 1, maxRain: 0.4, averageCloudCover: 80 }, hours: [] }), "rain");
});
