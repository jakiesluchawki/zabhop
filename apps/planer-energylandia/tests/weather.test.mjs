import test from "node:test";
import assert from "node:assert/strict";
import {
  formatFreshness,
  loadWeather,
  OFFICIAL_PARK_CALENDAR_URL,
  PARK_HOURS,
  summarizeWeatherSources,
  todayAndTomorrow,
} from "../src/weather.js";

test("domyślne godziny są założeniem, a nie potwierdzonym kalendarzem parku", () => {
  assert.equal(PARK_HOURS.open, 10);
  assert.equal(PARK_HOURS.close, 20);
  assert.equal(PARK_HOURS.confirmed, false);
  assert.equal(PARK_HOURS.sourceUrl, OFFICIAL_PARK_CALENDAR_URL);
  assert.equal(OFFICIAL_PARK_CALENDAR_URL, "https://energylandia.pl/kalendarz/");
});

test("podsumowanie pokazuje rzeczywistą liczbę dostępnych źródeł", () => {
  const summary = summarizeWeatherSources({
    numericSourceCount: 1,
    forecastStatus: "ready",
    checkedAt: "2026-08-23T10:00:00.000Z",
    sources: [
      { name: "Open-Meteo", status: "ok" },
      { name: "MET Norway", status: "error" },
      { name: "Antistorm", status: "error" },
    ],
  });

  assert.equal(summary.availableCount, 1);
  assert.equal(summary.totalCount, 3);
  assert.equal(summary.numericSourceCount, 1);
  assert.equal(summary.hasForecast, true);
  assert.equal(summary.hasNowcast, false);
  assert.deepEqual(summary.unavailableNames, ["MET Norway", "Antistorm"]);
});

test("brak wszystkich modeli nie udaje świeżej ani kompletnej prognozy", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("źródło niedostępne"); };
  t.after(() => { globalThis.fetch = originalFetch; });

  const weather = await loadWeather();

  assert.equal(weather.numericSourceCount, 0);
  assert.equal(weather.availableSourceCount, 0);
  assert.equal(weather.forecastStatus, "unavailable");
  assert.equal(weather.updatedAt, null);
  assert.ok(Number.isFinite(Date.parse(weather.checkedAt)));
  assert.equal(Object.values(weather.days).every((hours) => hours.length === 0), true);
  assert.equal(summarizeWeatherSources(weather).hasForecast, false);
});

test("jeden działający model i nowcast są oznaczane bez wymyślania pięciu źródeł", async (t) => {
  const originalFetch = globalThis.fetch;
  const { today } = todayAndTomorrow();
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("api.open-meteo.com")) {
      return {
        ok: true,
        json: async () => ({
          hourly: {
            time: [`${today}T12:00`, `${today}T21:00`],
            temperature_2m: [22, 19],
            precipitation: [0, 0],
            precipitation_probability: [15, 10],
            weather_code: [1, 0],
            wind_gusts_10m: [18, 12],
            cloud_cover: [25, 15],
          },
        }),
      };
    }
    if (url.includes("antistorm.eu")) {
      return {
        ok: true,
        text: async () => JSON.stringify({ m: "Wadowice", p_o: 0, t_o: 255 }),
      };
    }
    throw new Error("źródło niedostępne");
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const weather = await loadWeather();
  const summary = summarizeWeatherSources(weather);

  assert.equal(weather.numericSourceCount, 1);
  assert.equal(weather.availableSourceCount, 2);
  assert.equal(weather.forecastStatus, "ready");
  assert.ok(Number.isFinite(Date.parse(weather.updatedAt)));
  assert.equal(weather.days[today].some((hour) => hour.hour === 21), true);
  assert.equal(summary.availableCount, 2);
  assert.equal(summary.totalCount, 5);
  assert.equal(summary.hasForecast, true);
  assert.equal(summary.hasNowcast, true);
});

test("niepoprawny znacznik czasu nie powoduje błędu interfejsu", () => {
  assert.equal(formatFreshness("niepoprawna data"), "brak czasu");
  assert.equal(formatFreshness(null), "brak czasu");
});
