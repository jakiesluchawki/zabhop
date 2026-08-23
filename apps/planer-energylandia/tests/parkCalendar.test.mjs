import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeParkCalendar,
  OFFICIAL_PARK_CALENDAR_URL,
  PARK_CALENDAR_MAX_AGE_MINUTES,
  parkCalendarFreshness,
  parkDayForDate,
} from "../src/parkCalendar.js";

const checkedAt = "2026-08-23T08:00:00.000Z";
const now = Date.parse("2026-08-23T10:00:00.000Z");

function calendar(overrides = {}) {
  return normalizeParkCalendar({
    schemaVersion: 1,
    source: {
      label: "Oficjalny kalendarz Energylandii",
      url: OFFICIAL_PARK_CALENDAR_URL,
      checkedAt,
      status: "fresh",
      timezone: "Europe/Warsaw",
      range: { from: "2026-08-23", to: "2026-12-24" },
      ...(overrides.source || {}),
    },
    days: {
      "2026-08-23": {
        date: "2026-08-23",
        status: "otwarte",
        opensAt: "10:00",
        closesAt: "20:00",
        title: "Holiday Time",
        shows: [
          {
            title: "Extreme Energylandia",
            link: "https://energylandia.pl/show/extreme-energylandia/",
            time: "13:30, 16:30, 13:30",
          },
          {
            title: "Nieoficjalny pokaz",
            link: "https://example.com/show/nieoficjalny/",
            time: "14:00",
          },
        ],
      },
      "2026-09-01": {
        date: "2026-09-01",
        status: "open",
        opensAt: "10:00",
        closesAt: "18:00",
      },
      "2026-12-24": {
        date: "2026-12-24",
        status: "zamkniete",
        opensAt: "00",
        closesAt: "00",
      },
      ...(overrides.days || {}),
    },
  });
}

test("oficjalny kalendarz potwierdza różne godziny dnia i jawne zamknięcie", () => {
  const data = calendar();
  const summer = parkDayForDate(data, "2026-08-23", { now });
  const september = parkDayForDate(data, "2026-09-01", { now });
  const christmas = parkDayForDate(data, "2026-12-24", { now });

  assert.equal(summer.state, "open");
  assert.equal(summer.confirmed, true);
  assert.equal(summer.opensAt, "10:00");
  assert.equal(summer.closesAt, "20:00");
  assert.equal(september.closesAt, "18:00");
  assert.equal(christmas.state, "closed");
  assert.equal(christmas.isOpen, false);
  assert.equal(christmas.opensAt, null);
  assert.equal(christmas.closesAt, null);
  assert.equal(summer.sourceUrl, OFFICIAL_PARK_CALENDAR_URL);
});

test("pokazy w kalendarzu zachowują wyłącznie oficjalny adres i prawdziwe godziny", () => {
  const day = parkDayForDate(calendar(), "2026-08-23", now);
  assert.deepEqual(day.shows, [{
    title: "Extreme Energylandia",
    url: "https://energylandia.pl/show/extreme-energylandia/",
    times: ["13:30", "16:30"],
  }]);
});

test("brak dnia nie jest prezentowany jako zamknięcie ani stałe godziny 10–20", () => {
  const day = parkDayForDate(calendar(), "2026-09-02", { now });
  assert.equal(day.state, "unknown");
  assert.equal(day.confirmed, false);
  assert.equal(day.isOpen, null);
  assert.equal(day.opensAt, null);
  assert.equal(day.closesAt, null);
  assert.equal(day.reason, "unavailable-date");
});

test("godziny i pokazy tracą potwierdzenie po 36 godzinach", () => {
  const data = calendar();
  const deadline = Date.parse(checkedAt) + PARK_CALENDAR_MAX_AGE_MINUTES * 60_000;

  assert.equal(parkCalendarFreshness(data, deadline).state, "fresh");
  assert.equal(parkCalendarFreshness(data, deadline + 1).state, "stale");
  const staleDay = parkDayForDate(data, "2026-08-23", { now: deadline + 1 });
  assert.equal(staleDay.state, "unknown");
  assert.equal(staleDay.reason, "stale");
  assert.equal(staleDay.opensAt, null);
  assert.deepEqual(staleDay.shows, []);
});

test("niepoprawny dzień, godziny lub oficjalny adres nie zostają uznane za wiarygodne", () => {
  const data = calendar({
    source: { url: "https://example.com/kalendarz/" },
    days: {
      "2026-02-30": { date: "2026-02-30", status: "open", opensAt: "10:00", closesAt: "18:00" },
      "2026-09-02": { date: "2026-09-02", status: "open", opensAt: "10:00", closesAt: "00" },
      "2026-09-03": { date: "2026-09-03", status: "open", opensAt: "18:00", closesAt: "10:00" },
      "2026-09-04": { date: "2026-09-05", status: "open", opensAt: "10:00", closesAt: "18:00" },
      "2026-09-05": { date: "2026-09-05", status: "maybe", opensAt: "10:00", closesAt: "18:00" },
    },
  });

  assert.equal(data.source.url, OFFICIAL_PARK_CALENDAR_URL);
  assert.equal(data.days["2026-02-30"], undefined);
  assert.equal(data.days["2026-09-02"], undefined);
  assert.equal(data.days["2026-09-03"], undefined);
  assert.equal(data.days["2026-09-04"], undefined);
  assert.equal(data.days["2026-09-05"], undefined);
  assert.equal(parkDayForDate(data, "2026-02-30", { now }).reason, "invalid-date");
});

test("brak źródła lub przyszły zegar nigdy nie podszywa się pod świeży kalendarz", () => {
  const unavailable = normalizeParkCalendar({
    source: { checkedAt: null, status: "unavailable" },
    days: {},
  });
  assert.equal(parkCalendarFreshness(unavailable, now).state, "unknown");
  assert.equal(parkDayForDate(unavailable, "2026-08-23", { now }).state, "unknown");

  const future = calendar({ source: { checkedAt: "2026-08-23T12:00:00.000Z" } });
  assert.equal(parkCalendarFreshness(future, now).state, "unknown");
});

test("zdublowany oficjalny pokaz scala datowane godziny bez duplikatów", () => {
  const data = calendar({
    days: {
      "2026-08-23": {
        date: "2026-08-23",
        status: "open",
        opensAt: "10:00",
        closesAt: "20:00",
        shows: [
          { title: "Parada", url: "https://energylandia.pl/show/parada/", times: ["19:45", "invalid"] },
          { title: "Parada", url: "https://energylandia.pl/show/parada/", times: ["18:15", "19:45"] },
        ],
      },
    },
  });

  assert.deepEqual(data.days["2026-08-23"].shows[0].times, ["18:15", "19:45"]);
});
