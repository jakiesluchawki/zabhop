import assert from "node:assert/strict";
import test from "node:test";
import {
  showDateAvailability,
  showScheduleFreshness,
  showsOnDate,
} from "../src/shows.js";

const checkedAt = "2026-07-14T08:00:00.000Z";

function show(id, date, { stale = false } = {}) {
  return {
    id,
    title: id,
    stale,
    completeForScheduling: true,
    schedule: [{ date, times: ["15:00"] }],
  };
}

function schedule(overrides = {}) {
  return {
    source: {
      checkedAt,
      status: "fresh",
      scheduleRange: { from: "2026-07-14", to: "2026-07-17" },
    },
    shows: [
      show("piraci", "2026-07-14"),
      show("balony", "2026-07-16"),
      show("retained", "2026-07-15", { stale: true }),
    ],
    ...overrides,
  };
}

test("official show schedule stays eligible for planning through the real Pages refresh cadence", () => {
  assert.equal(showScheduleFreshness(schedule(), Date.parse("2026-07-14T11:59:00.000Z")).state, "fresh");
  assert.equal(showScheduleFreshness(schedule(), Date.parse("2026-07-14T12:01:00.000Z")).state, "aging");
  assert.equal(showScheduleFreshness(schedule(), Date.parse("2026-07-14T20:01:00.000Z")).state, "stale");
});

test("calendar distinguishes available dates, no-event dates and dates outside the official snapshot", () => {
  const data = schedule();

  const available = showDateAvailability(data, "2026-07-14");
  assert.equal(available.state, "available");
  assert.deepEqual(available.shows.map((entry) => entry.id), ["piraci"]);

  const noEvents = showDateAvailability(data, "2026-07-17");
  assert.equal(noEvents.state, "no-events");
  assert.deepEqual(noEvents.range, { from: "2026-07-14", to: "2026-07-17" });

  const outsideRange = showDateAvailability(data, "2026-07-18");
  assert.equal(outsideRange.state, "outside-range");
  assert.deepEqual(outsideRange.shows, []);
});

test("retained stale event data never masquerades as a current calendar entry", () => {
  const data = schedule();
  assert.deepEqual(showsOnDate(data, "2026-07-15"), []);
  assert.equal(showDateAvailability(data, "2026-07-15").state, "retained-stale");
});

test("missing or malformed calendar data resolves to an honest unavailable state", () => {
  assert.deepEqual(showsOnDate({ shows: {} }, "2026-07-14"), []);
  assert.equal(showDateAvailability({ source: { checkedAt }, shows: {} }, "2026-07-14").state, "unavailable");
});
