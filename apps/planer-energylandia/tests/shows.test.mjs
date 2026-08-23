import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeOfficialShowCalendar,
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

function verifiedDetails({ checkedAt: detailsCheckedAt = "2026-07-14T09:30:00.000Z", description = "Pełny oficjalny opis pokazu dla rodziny.", venue = "Teatr Colosseo" } = {}) {
  return {
    source: {
      url: "https://energylandia.pl/show/",
      checkedAt: detailsCheckedAt,
      status: "fresh",
      scheduleRange: { from: "2026-07-14", to: "2026-07-15" },
    },
    shows: [{
      id: "magic-show",
      title: "Magic Show",
      url: "https://energylandia.pl/show/magic-show/",
      description,
      venue,
      durationMinutes: 20,
      mapUrl: "https://energylandia.pl/mapa-parku/?location=54",
      checkedAt: detailsCheckedAt,
      stale: false,
      completeForScheduling: true,
      schedule: [{ date: "2026-07-14", times: ["11:00"] }],
    }],
  };
}

function officialCalendar({ checkedAt: calendarCheckedAt = "2026-07-14T09:45:00.000Z", shows = null } = {}) {
  return {
    source: {
      url: "https://energylandia.pl/kalendarz/",
      checkedAt: calendarCheckedAt,
      status: "fresh",
    },
    days: {
      "2026-07-14": {
        date: "2026-07-14",
        status: "open",
        opensAt: "10:00",
        closesAt: "18:00",
        shows: shows || [
          { title: "Magic Show", url: "https://energylandia.pl/show/magic-show", times: ["09:45", "13:30", "17:50"] },
          { title: "Nieznany pokaz", url: "https://energylandia.pl/show/unknown-show/", times: ["14:00"] },
        ],
      },
    },
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

test("oficjalny kalendarz aktualizuje tylko pokaz z kompletnym opisem i identycznym oficjalnym URL", () => {
  const now = Date.parse("2026-07-14T10:00:00.000Z");
  const original = verifiedDetails();
  const merged = mergeOfficialShowCalendar(original, officialCalendar(), { now });
  const shows = showsOnDate(merged, "2026-07-14", { schedulableOnly: true });

  assert.equal(merged.source.status, "fresh");
  assert.equal(merged.source.checkedAt, "2026-07-14T09:45:00.000Z");
  assert.equal(merged.source.detailsCheckedAt, "2026-07-14T09:30:00.000Z");
  assert.equal(shows.length, 1);
  assert.equal(shows[0].title, "Magic Show");
  assert.deepEqual(shows[0].times, ["13:30"]);
  assert.equal(shows[0].description, original.shows[0].description);
  assert.equal(shows[0].durationMinutes, 20);
  assert.equal(shows[0].venue, "Teatr Colosseo");
  assert.equal(shows[0].detailsCheckedAt, "2026-07-14T09:30:00.000Z");
  assert.equal(original.shows[0].schedule[0].times[0], "11:00");
});

test("świeży kalendarz nie udaje świeżych opisów i nie pozwala automatycznie wpisać starego pokazu", () => {
  const now = Date.parse("2026-07-14T10:00:00.000Z");
  const staleDetails = verifiedDetails({ checkedAt: "2026-07-13T03:00:00.000Z" });
  const merged = mergeOfficialShowCalendar(staleDetails, officialCalendar(), { now });

  assert.equal(merged.source.status, "partial");
  assert.equal(merged.source.detailsCheckedAt, "2026-07-13T03:00:00.000Z");
  assert.notEqual(showScheduleFreshness(merged, now).state, "fresh");
  assert.equal(merged.shows[0].stale, true);
  assert.equal(merged.shows[0].completeForScheduling, false);
  assert.equal(showsOnDate(merged, "2026-07-14").length, 1);
  assert.equal(showsOnDate(merged, "2026-07-14", { schedulableOnly: true }).length, 0);
});

test("niepełny opis, brak miejsca, niedopasowany adres albo stary kalendarz nie wytwarzają godzin", () => {
  const now = Date.parse("2026-07-14T10:00:00.000Z");
  for (const details of [
    verifiedDetails({ description: "" }),
    verifiedDetails({ venue: "" }),
  ]) {
    assert.equal(mergeOfficialShowCalendar(details, officialCalendar(), { now }), details);
  }

  const unmatched = officialCalendar({ shows: [
    { title: "Magic Show", url: "https://energylandia.pl/show/another-show/", times: ["13:30"] },
  ] });
  const original = verifiedDetails();
  assert.equal(mergeOfficialShowCalendar(original, unmatched, { now }), original);
  assert.equal(mergeOfficialShowCalendar(original, officialCalendar({ checkedAt: "2026-07-10T09:45:00.000Z" }), { now }), original);
  assert.equal(mergeOfficialShowCalendar(null, officialCalendar(), { now }), null);
});
