const OFFICIAL_SHOW_INDEX = "https://energylandia.pl/show/";
// GitHub Pages republishes the official snapshot on a best-effort schedule. In
// practice GitHub may coalesce cron runs, so a 90-minute window made a healthy
// official snapshot disappear for most of the day. Four hours still keeps an
// automatic itinerary conservative, while matching the real publishing
// cadence. Older data remains useful as a clearly labelled calendar, never as
// an invented plan entry.
const FRESH_FOR_PLANNING_MINUTES = 4 * 60;
const AGING_SCHEDULE_MINUTES = 12 * 60;

function validTime(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

function validDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function rangeFromSchedule(data) {
  const declared = data?.source?.scheduleRange;
  if (validDateKey(declared?.from) && validDateKey(declared?.to) && declared.from <= declared.to) {
    return { from: declared.from, to: declared.to };
  }
  const dates = (Array.isArray(data?.shows) ? data.shows : [])
    .flatMap((show) => Array.isArray(show?.schedule) ? show.schedule.map((slot) => slot?.date) : [])
    .filter(validDateKey)
    .sort();
  return dates.length ? { from: dates[0], to: dates.at(-1) } : null;
}

function officialUrl(value, path = "/") {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "energylandia.pl" && url.pathname.startsWith(path)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function normaliseShow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const url = officialUrl(raw.url, "/show/");
  const id = String(raw.id || "").trim().slice(0, 100);
  const title = String(raw.title || "").trim().slice(0, 160);
  const durationMinutes = Number(raw.durationMinutes);
  if (!id || !title || !url || !Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 120) return null;
  const schedule = Array.isArray(raw.schedule) ? raw.schedule.map((entry) => {
    const date = validDateKey(entry?.date) ? entry.date : null;
    const times = Array.isArray(entry?.times) ? [...new Set(entry.times.filter(validTime))] : [];
    return date && times.length ? { date, label: String(entry.label || "").slice(0, 80), times } : null;
  }).filter(Boolean) : [];
  return {
    id,
    title,
    url,
    description: String(raw.description || "").trim().slice(0, 1_200),
    durationMinutes,
    durationLabel: String(raw.durationLabel || `${durationMinutes} min`).slice(0, 40),
    venue: String(raw.venue || "Miejsce na terenie parku").trim().slice(0, 140),
    mapUrl: officialUrl(raw.mapUrl, "/mapa-parku/") || null,
    imageUrl: officialUrl(raw.imageUrl, "/wp-content/uploads/") || null,
    officialModifiedAt: Number.isFinite(Date.parse(raw.officialModifiedAt)) ? new Date(raw.officialModifiedAt).toISOString() : null,
    checkedAt: Number.isFinite(Date.parse(raw.checkedAt)) ? new Date(raw.checkedAt).toISOString() : null,
    completeForScheduling: raw.completeForScheduling === true,
    stale: raw.stale === true,
    schedule,
  };
}

export async function loadShowSchedule(signal) {
  const response = await fetch(`${import.meta.env.BASE_URL}live-shows.json`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Pokazy: HTTP ${response.status}`);
  const payload = await response.json();
  const checkedAt = Number.isFinite(Date.parse(payload?.source?.checkedAt))
    ? new Date(payload.source.checkedAt).toISOString()
    : null;
  return {
    source: {
      label: String(payload?.source?.label || "Oficjalny terminarz Energylandii").slice(0, 140),
      url: officialUrl(payload?.source?.url, "/show/") || OFFICIAL_SHOW_INDEX,
      checkedAt,
      status: ["fresh", "partial"].includes(payload?.source?.status) ? payload.source.status : "unknown",
      scheduleRange: validDateKey(payload?.source?.scheduleRange?.from) && validDateKey(payload?.source?.scheduleRange?.to)
        ? { from: payload.source.scheduleRange.from, to: payload.source.scheduleRange.to }
        : null,
      note: String(payload?.source?.note || "Godziny mogą zmienić się operacyjnie; sprawdź tablice na miejscu.").slice(0, 260),
    },
    shows: Array.isArray(payload?.shows) ? payload.shows.map(normaliseShow).filter(Boolean) : [],
  };
}

export function showScheduleFreshness(data, now = Date.now()) {
  const checkedAt = Date.parse(data?.source?.checkedAt || "");
  if (!Number.isFinite(checkedAt)) return { state: "unknown", label: "brak czasu sprawdzenia" };
  const minutes = Math.max(0, Math.round((now - checkedAt) / 60_000));
  if (data?.source?.status === "fresh" && minutes <= FRESH_FOR_PLANNING_MINUTES) {
    return { state: "fresh", label: minutes < 2 ? "sprawdzone przed chwilą" : `sprawdzone ${minutes} min temu` };
  }
  if (minutes <= AGING_SCHEDULE_MINUTES) return { state: "aging", label: `sprawdzone ${minutes} min temu` };
  return { state: "stale", label: minutes < 120 ? `sprawdzone ${minutes} min temu` : `sprawdzone ${Math.round(minutes / 60)} godz. temu` };
}

export function showsOnDate(data, dateKey, { schedulableOnly = false, includeRetainedStale = false } = {}) {
  if (!validDateKey(dateKey)) return [];
  return (Array.isArray(data?.shows) ? data.shows : [])
    .filter((show) => (includeRetainedStale || !show.stale) && (!schedulableOnly || show.completeForScheduling))
    .flatMap((show) => (show.schedule || [])
      .filter((slot) => slot.date === dateKey)
      .map((slot) => ({ ...show, times: slot.times, date: slot.date, scheduleLabel: slot.label })))
    .sort((a, b) => a.title.localeCompare(b.title, "pl"));
}

/**
 * Keeps the UI honest when a group chooses a date which is outside the short
 * range published by Energylandia. An absent list is no longer indistinguish-
 * able from a broken calendar request.
 */
export function showDateAvailability(data, dateKey) {
  const range = rangeFromSchedule(data);
  if (!validDateKey(dateKey)) return { state: "invalid-date", shows: [], range };

  const shows = showsOnDate(data, dateKey);
  if (shows.length) return { state: "available", shows, range };

  const retainedOnly = showsOnDate(data, dateKey, { includeRetainedStale: true });
  if (retainedOnly.length) return { state: "retained-stale", shows: [], range };
  if (!range) return { state: "unavailable", shows: [], range: null };
  if (dateKey < range.from || dateKey > range.to) return { state: "outside-range", shows: [], range };
  return { state: "no-events", shows: [], range };
}

export { AGING_SCHEDULE_MINUTES, FRESH_FOR_PLANNING_MINUTES, OFFICIAL_SHOW_INDEX };
