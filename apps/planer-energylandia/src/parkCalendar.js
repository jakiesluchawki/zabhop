const OFFICIAL_PARK_CALENDAR_URL = "https://energylandia.pl/kalendarz/";
const PARK_CALENDAR_MAX_AGE_MINUTES = 36 * 60;
const PARK_CALENDAR_MAX_AGE_MS = PARK_CALENDAR_MAX_AGE_MINUTES * 60_000;

function validDateKey(value) {
  const dateKey = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === dateKey;
}

function validTime(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

function officialUrl(value, path) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "energylandia.pl"
      && url.pathname.startsWith(path)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function normalizeCalendarShow(show) {
  if (!show || typeof show !== "object") return null;

  const title = String(show.title || "").trim().slice(0, 160);
  const url = officialUrl(show.url || show.link, "/show/");
  const candidates = Array.isArray(show.times)
    ? show.times
    : String(show.time || "").split(",");
  const times = [...new Set(candidates.map((time) => String(time).trim()).filter(validTime))].sort();

  return title && url && times.length ? { title, url, times } : null;
}

function normalizeCalendarDay(dateKey, raw) {
  if (!validDateKey(dateKey) || !raw || typeof raw !== "object") return null;
  if (raw.date && raw.date !== dateKey) return null;

  const status = raw.status === "open" || raw.status === "otwarte"
    ? "open"
    : raw.status === "closed" || raw.status === "zamkniete"
      ? "closed"
      : null;
  if (!status) return null;

  const opensAt = status === "open" ? raw.opensAt || raw.time_od || null : null;
  const closesAt = status === "open" ? raw.closesAt || raw.time_do || null : null;
  if (status === "open" && (!validTime(opensAt) || !validTime(closesAt) || opensAt >= closesAt)) {
    return null;
  }

  const rawShows = Array.isArray(raw.shows) ? raw.shows : raw.show;
  const showsByUrl = new Map();
  if (status === "open" && Array.isArray(rawShows)) {
    rawShows.forEach((rawShow) => {
      const show = normalizeCalendarShow(rawShow);
      if (!show) return;
      const previous = showsByUrl.get(show.url);
      if (previous) {
        previous.times = [...new Set([...previous.times, ...show.times])].sort();
      } else {
        showsByUrl.set(show.url, show);
      }
    });
  }

  return {
    date: dateKey,
    status,
    opensAt,
    closesAt,
    title: String(raw.title || "").trim().slice(0, 160),
    shows: [...showsByUrl.values()],
  };
}

export function normalizeParkCalendar(payload) {
  const source = payload?.source;
  const checkedAtMs = Date.parse(source?.checkedAt || "");
  const checkedAt = Number.isFinite(checkedAtMs) ? new Date(checkedAtMs).toISOString() : null;
  const rawDays = payload?.days && typeof payload.days === "object" && !Array.isArray(payload.days)
    ? payload.days
    : {};
  const days = {};

  Object.entries(rawDays)
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([dateKey, raw]) => {
      const day = normalizeCalendarDay(dateKey, raw);
      if (day) days[dateKey] = day;
    });

  const dateKeys = Object.keys(days);
  const declaredRange = source?.range;
  const range = validDateKey(declaredRange?.from)
    && validDateKey(declaredRange?.to)
    && declaredRange.from <= declaredRange.to
    ? { from: declaredRange.from, to: declaredRange.to }
    : dateKeys.length
      ? { from: dateKeys[0], to: dateKeys.at(-1) }
      : null;

  return {
    schemaVersion: 1,
    source: {
      label: String(source?.label || "Oficjalny kalendarz Energylandii").trim().slice(0, 140),
      url: officialUrl(source?.url, "/kalendarz/") || OFFICIAL_PARK_CALENDAR_URL,
      checkedAt,
      status: source?.status === "fresh" && checkedAt && dateKeys.length ? "fresh" : "unavailable",
      timezone: "Europe/Warsaw",
      range,
    },
    days,
  };
}

export function parkCalendarFreshness(calendar, now = Date.now()) {
  const checkedAtMs = Date.parse(calendar?.source?.checkedAt || "");
  const checkedAt = Number.isFinite(checkedAtMs) ? new Date(checkedAtMs).toISOString() : null;
  const nowMs = now instanceof Date ? now.getTime() : Number(now);

  if (calendar?.source?.status !== "fresh" || !checkedAt || !Number.isFinite(nowMs)) {
    return { state: "unknown", label: "brak potwierdzonego kalendarza", checkedAt, ageMinutes: null };
  }

  const ageMs = nowMs - checkedAtMs;
  if (ageMs < -5 * 60_000) {
    return { state: "unknown", label: "nieprawidłowy czas sprawdzenia", checkedAt, ageMinutes: null };
  }

  const ageMinutes = Math.max(0, Math.round(ageMs / 60_000));
  const label = ageMinutes < 2
    ? "sprawdzono przed chwilą"
    : ageMinutes < 120
      ? `sprawdzono ${ageMinutes} min temu`
      : `sprawdzono ${Math.round(ageMinutes / 60)} godz. temu`;

  return {
    state: ageMs <= PARK_CALENDAR_MAX_AGE_MS ? "fresh" : "stale",
    label,
    checkedAt,
    ageMinutes,
  };
}

export function parkDayForDate(calendar, dateKey, options = {}) {
  const now = options instanceof Date || typeof options === "number"
    ? options
    : options?.now ?? Date.now();
  const freshness = parkCalendarFreshness(calendar, now);
  const date = validDateKey(dateKey) ? dateKey : null;
  const sourceUrl = officialUrl(calendar?.source?.url, "/kalendarz/") || OFFICIAL_PARK_CALENDAR_URL;
  const unknownDay = (reason) => ({
    state: "unknown",
    confirmed: false,
    isOpen: null,
    date,
    opensAt: null,
    closesAt: null,
    title: "",
    shows: [],
    sourceUrl,
    checkedAt: freshness.checkedAt,
    freshness,
    reason,
  });

  if (!date) return unknownDay("invalid-date");
  if (freshness.state !== "fresh") return unknownDay(freshness.state);

  const rawDay = calendar?.days?.[date];
  const day = normalizeCalendarDay(date, rawDay);
  if (!day) return unknownDay("unavailable-date");

  return {
    state: day.status,
    confirmed: true,
    isOpen: day.status === "open",
    date,
    opensAt: day.opensAt,
    closesAt: day.closesAt,
    title: day.title,
    shows: day.shows,
    sourceUrl,
    checkedAt: freshness.checkedAt,
    freshness,
    reason: null,
  };
}

export async function loadParkCalendar(signal) {
  const response = await fetch(`${import.meta.env.BASE_URL}park-calendar.json`, {
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Kalendarz parku: HTTP ${response.status}`);
  return normalizeParkCalendar(await response.json());
}

export { OFFICIAL_PARK_CALENDAR_URL, PARK_CALENDAR_MAX_AGE_MINUTES };
