import { classifyProviderForecast } from "./decision.js";

export const ZATOR = { latitude: 49.998, longitude: 19.437 };
export const PARK_HOURS = { open: 10, close: 20 };

function localParts(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

export function dayKey(date) {
  const parts = localParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localHour(date) {
  return Number(localParts(date).hour);
}

export function nextLocalHour(date = new Date()) {
  const parts = localParts(date);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return hour + (minute > 0 ? 1 : 0);
}

export function todayAndTomorrow() {
  const now = new Date();
  const today = dayKey(now);
  const noon = new Date(`${today}T12:00:00+02:00`);
  const tomorrow = dayKey(new Date(noon.getTime() + 24 * 60 * 60 * 1000));
  const dayAfterTomorrow = dayKey(new Date(noon.getTime() + 2 * 24 * 60 * 60 * 1000));
  return { today, tomorrow, dayAfterTomorrow };
}

async function fetchWithTimeout(url, options = {}, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOpenMeteo() {
  const params = new URLSearchParams({
    latitude: String(ZATOR.latitude),
    longitude: String(ZATOR.longitude),
    hourly: "temperature_2m,precipitation_probability,precipitation,weather_code,wind_gusts_10m,cloud_cover",
    timezone: "Europe/Warsaw",
    forecast_days: "3",
  });
  const response = await fetchWithTimeout(`https://api.open-meteo.com/v1/forecast?${params}`);
  const json = await response.json();
  const hours = json.hourly.time.map((time, index) => ({
    day: time.slice(0, 10),
    hour: Number(time.slice(11, 13)),
    temperature: json.hourly.temperature_2m[index],
    precipitation: json.hourly.precipitation[index],
    precipProbability: json.hourly.precipitation_probability[index],
    weatherCode: json.hourly.weather_code[index],
    gust: json.hourly.wind_gusts_10m[index],
    cloudCover: json.hourly.cloud_cover[index],
  }));
  return { hours, updatedAt: new Date().toISOString() };
}

async function fetchMetNorway() {
  const response = await fetchWithTimeout(
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${ZATOR.latitude}&lon=${ZATOR.longitude}`,
    { headers: { Accept: "application/json" } },
  );
  const json = await response.json();
  const hours = json.properties.timeseries.map((entry) => {
    const date = new Date(entry.time);
    const details = entry.data.instant.details;
    const nextHour = entry.data.next_1_hours;
    return {
      day: dayKey(date),
      hour: localHour(date),
      temperature: details.air_temperature,
      precipitation: nextHour?.details?.precipitation_amount ?? null,
      symbol: nextHour?.summary?.symbol_code ?? entry.data.next_6_hours?.summary?.symbol_code ?? "",
      wind: details.wind_speed != null ? details.wind_speed * 3.6 : null,
      cloudCover: details.cloud_area_fraction,
    };
  });
  return { hours, updatedAt: json.properties.meta.updated_at };
}

async function fetchBrightSky(firstDay, lastDay) {
  const params = new URLSearchParams({
    lat: String(ZATOR.latitude),
    lon: String(ZATOR.longitude),
    date: firstDay,
    last_date: lastDay,
  });
  const response = await fetchWithTimeout(`https://api.brightsky.dev/weather?${params}`);
  const json = await response.json();
  const hours = (json.weather || []).map((entry) => {
    const date = new Date(entry.timestamp);
    return {
      day: dayKey(date),
      hour: localHour(date),
      temperature: entry.temperature,
      precipitation: entry.precipitation,
      precipProbability: entry.precipitation_probability,
      gust: entry.wind_gust_speed,
      condition: entry.condition || "",
      symbol: entry.icon || "",
      cloudCover: entry.cloud_cover,
    };
  });
  return { hours, updatedAt: new Date().toISOString() };
}

function parseIcmDate(value) {
  if (!/^\d{10}$/.test(value)) return null;
  return new Date(Date.UTC(
    Number(value.slice(0, 4)),
    Number(value.slice(4, 6)) - 1,
    Number(value.slice(6, 8)),
    Number(value.slice(8, 10)),
  ));
}

async function fetchIcm() {
  const pageUrl = "https://www.meteo.pl/um/php/meteorogram_id_um.php?id=614&ntype=0u";
  const response = await fetchWithTimeout(pageUrl);
  const html = await response.text();
  const forecastDate = html.match(/var fcstdate = "(\d{10})"/)?.[1];
  const column = html.match(/var act_x = (\d+)/)?.[1];
  const row = html.match(/var act_y = (\d+)/)?.[1];
  if (!forecastDate || !column || !row) throw new Error("Nie rozpoznano parametrów meteorogramu ICM");
  return {
    updatedAt: parseIcmDate(forecastDate)?.toISOString() ?? null,
    pageUrl,
    imageUrl: `https://www.meteo.pl/um/metco/mgram_pict.php?ntype=0u&fdate=${forecastDate}&row=${row}&col=${column}&lang=pl`,
    forecastDate,
  };
}

export async function loadAntistormNowcast() {
  const response = await fetchWithTimeout("https://antistorm.eu/webservice.php?id=385");
  const raw = await response.text();
  const json = JSON.parse(raw.trim());
  return { ...json, updatedAt: new Date().toISOString() };
}

function median(values) {
  const sorted = values.filter((value) => value != null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function conservativeHigh(values) {
  const sorted = values.filter((value) => value != null).sort((a, b) => b - a);
  if (!sorted.length) return null;
  return sorted.length >= 3 ? sorted[1] : sorted[0];
}

function mergeDay(day, openMeteo, metNorway, brightSky) {
  const omMap = new Map((openMeteo?.hours || []).filter((hour) => hour.day === day).map((hour) => [hour.hour, hour]));
  const metMap = new Map((metNorway?.hours || []).filter((hour) => hour.day === day).map((hour) => [hour.hour, hour]));
  const dwdMap = new Map((brightSky?.hours || []).filter((hour) => hour.day === day).map((hour) => [hour.hour, hour]));
  const hours = [];

  for (let hour = PARK_HOURS.open; hour < PARK_HOURS.close; hour += 1) {
    const om = omMap.get(hour);
    const met = metMap.get(hour);
    const dwd = dwdMap.get(hour);
    if (!om && !met && !dwd) continue;
    const omThunder = om ? [95, 96, 99].includes(om.weatherCode) : false;
    const metThunder = met?.symbol?.includes("thunder") || false;
    const dwdThunder = dwd?.condition?.includes("thunder") || dwd?.symbol?.includes("thunder") || false;
    const providerClasses = [];
    if (om) providerClasses.push(classifyProviderForecast({
      precipitation: om.precipitation,
      precipProbability: om.precipProbability,
      thunder: omThunder,
    }));
    if (met) providerClasses.push(classifyProviderForecast({ precipitation: met.precipitation, thunder: metThunder }));
    if (dwd) providerClasses.push(classifyProviderForecast({
      precipitation: dwd.precipitation,
      precipProbability: dwd.precipProbability,
      thunder: dwdThunder,
    }));

    hours.push({
      day,
      hour,
      label: `${String(hour).padStart(2, "0")}:00`,
      temperature: median([om?.temperature, met?.temperature, dwd?.temperature]),
      precipitation: conservativeHigh([om?.precipitation, met?.precipitation, dwd?.precipitation]),
      precipProbability: conservativeHigh([om?.precipProbability, dwd?.precipProbability]),
      thunderProbability: omThunder || metThunder || dwdThunder ? 100 : 0,
      gust: conservativeHigh([om?.gust, met?.wind != null ? met.wind * 1.35 : null, dwd?.gust]),
      cloudCover: median([om?.cloudCover, met?.cloudCover, dwd?.cloudCover]),
      providerClasses,
      providers: { openMeteo: om || null, metNorway: met || null, brightSky: dwd || null },
    });
  }
  return hours;
}

function sourceRecord(name, result, okDetail, errorDetail, href) {
  if (result.status === "fulfilled") {
    return { name, status: "ok", detail: okDetail(result.value), updatedAt: result.value.updatedAt, href };
  }
  return { name, status: "error", detail: errorDetail, updatedAt: null, href };
}

export async function loadWeather() {
  const { today, tomorrow, dayAfterTomorrow } = todayAndTomorrow();
  const [openMeteoResult, metResult, brightSkyResult, icmResult, antistormResult] = await Promise.allSettled([
    fetchOpenMeteo(),
    fetchMetNorway(),
    fetchBrightSky(today, dayAfterTomorrow),
    fetchIcm(),
    loadAntistormNowcast(),
  ]);

  const openMeteo = openMeteoResult.status === "fulfilled" ? openMeteoResult.value : null;
  const metNorway = metResult.status === "fulfilled" ? metResult.value : null;
  const brightSky = brightSkyResult.status === "fulfilled" ? brightSkyResult.value : null;
  const icm = icmResult.status === "fulfilled" ? icmResult.value : null;
  const antistorm = antistormResult.status === "fulfilled" ? antistormResult.value : null;

  const sources = [
    sourceRecord("ICM UM 4 km", icmResult, () => "Trend na dzień • przebieg modelu, nie alert", "Meteorogram chwilowo niedostępny", icm?.pageUrl),
    sourceRecord("Open-Meteo", openMeteoResult, () => "Prognoza godzinowa • Zator", "Brak odpowiedzi API", "https://open-meteo.com/"),
    sourceRecord("MET Norway", metResult, () => "Locationforecast • Zator", "Brak odpowiedzi API", "https://api.met.no/"),
    sourceRecord("DWD / Bright Sky", brightSkyResult, () => "Niemiecki model DWD • Zator", "Brak odpowiedzi API", "https://brightsky.dev/"),
    sourceRecord("Antistorm", antistormResult, (value) => `Nowcast co 15 min • ${value.m} (najbliższy punkt)`, "Nowcast chwilowo niedostępny", "https://antistorm.eu/"),
  ];

  return {
    days: {
      [today]: mergeDay(today, openMeteo, metNorway, brightSky),
      [tomorrow]: mergeDay(tomorrow, openMeteo, metNorway, brightSky),
      [dayAfterTomorrow]: mergeDay(dayAfterTomorrow, openMeteo, metNorway, brightSky),
    },
    today,
    tomorrow,
    dayAfterTomorrow,
    sources,
    icm,
    antistorm,
    numericSourceCount: [openMeteo, metNorway, brightSky].filter(Boolean).length,
    updatedAt: new Date().toISOString(),
  };
}

export function formatFreshness(iso) {
  if (!iso) return "brak czasu";
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatPolishDay(dateKey, short = false) {
  const date = new Date(`${dateKey}T12:00:00+02:00`);
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    weekday: short ? "short" : "long",
    day: "numeric",
    month: short ? "short" : "long",
  }).format(date);
}
