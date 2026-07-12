(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ZabHopStoreHours = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const DAY_INDEX = { Mo: 0, Tu: 1, We: 2, Th: 3, Fr: 4, Sa: 5, Su: 6 };
  const WEEKDAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const MONTH_TOKENS = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|week|easter)\b/i;
  const LIKELY_OPEN_START = 7 * 60;
  const LIKELY_OPEN_END = 21 * 60;
  const LIKELY_OPEN_DISTANCE_PENALTY = 350;

  function parseClock(value) {
    const match = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (minute > 59 || hour > 24 || (hour === 24 && minute !== 0)) return null;
    return hour * 60 + minute;
  }

  function parseRange(value, midnightMeansAllDay = false) {
    const match = String(value).trim().match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?)$/);
    if (!match) return null;
    const start = parseClock(match[1]);
    const end = parseClock(match[2]);
    if (start == null || end == null) return null;
    if (midnightMeansAllDay && start === 0 && end === 0) return [0, 1440];
    return [start, end];
  }

  function expandDayToken(token) {
    const trimmed = token.trim();
    if (DAY_INDEX[trimmed] != null) return [DAY_INDEX[trimmed]];
    const range = trimmed.match(/^(Mo|Tu|We|Th|Fr|Sa|Su)-(Mo|Tu|We|Th|Fr|Sa|Su)$/);
    if (!range) return null;
    const days = [];
    let cursor = DAY_INDEX[range[1]];
    const end = DAY_INDEX[range[2]];
    for (let count = 0; count < 7; count += 1) {
      days.push(cursor);
      if (cursor === end) return days;
      cursor = (cursor + 1) % 7;
    }
    return null;
  }

  function encodeIntervals(intervals) {
    if (!intervals.length) return "";
    const sorted = intervals
      .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [];
    for (const interval of sorted) {
      const previous = merged[merged.length - 1];
      if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
      else merged.push([...interval]);
    }
    return merged.map(([start, end]) => `${start}-${end}`).join(",");
  }

  function decodeIntervals(value) {
    if (value === "") return [];
    if (typeof value !== "string") return null;
    const intervals = value.split(",").map((part) => {
      const match = part.match(/^(\d+)-(\d+)$/);
      return match ? [Number(match[1]), Number(match[2])] : null;
    });
    return intervals.some((interval) => !interval) ? null : intervals;
  }

  function parseOsmOpeningHours(expression) {
    const raw = typeof expression === "string" ? expression.trim() : "";
    if (!raw) return null;
    if (raw === "24/7") return { hours: Array(7).fill("0-1440"), holidaysClosed: false };
    if (/^(?:off|closed)$/i.test(raw)) return { hours: Array(7).fill(""), holidaysClosed: false };
    if (MONTH_TOKENS.test(raw) || /["\[\]|]/.test(raw) || /sunrise|sunset|unknown|\+/i.test(raw)) return null;

    const days = Array.from({ length: 7 }, () => []);
    let touchedWeekday = false;
    let holidaysClosed = false;

    for (const rawRule of raw.split(";")) {
      const rule = rawRule.trim();
      if (!rule) continue;
      const match = rule.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?|PH)(?:\s*,\s*(?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?|PH))*)\s+(.+)$/);
      if (!match) return null;

      const selectorTokens = match[1].split(",").map((token) => token.trim());
      const includesHoliday = selectorTokens.includes("PH");
      const dayIndices = [];
      for (const token of selectorTokens.filter((value) => value !== "PH")) {
        const expanded = expandDayToken(token);
        if (!expanded) return null;
        dayIndices.push(...expanded);
      }

      const scheduleText = match[2].trim().replace(/\s+open$/i, "");
      if (/^(?:off|closed)$/i.test(scheduleText)) {
        if (includesHoliday) holidaysClosed = true;
        for (const day of new Set(dayIndices)) {
          // OSM rules after a semicolon override earlier rules for that day.
          days[day] = [];
          touchedWeekday = true;
        }
        continue;
      }
      if (includesHoliday) return null;

      const ranges = scheduleText.split(",").map((part) => parseRange(part));
      // Equal endpoints in OSM are ambiguous (closed vs. all day). Stay
      // conservative: only the explicit `24/7` form above means all day.
      if (!ranges.length || ranges.some((range) => !range || range[0] === range[1])) return null;
      const selectedDays = [...new Set(dayIndices)];
      // A later rule replaces only the days it explicitly selects. Overnight
      // spill is appended afterwards, without erasing the following day's own rule.
      for (const day of selectedDays) {
        days[day] = [];
        for (const [start, end] of ranges) {
          days[day].push(end > start ? [start, end] : [start, 1440]);
        }
        touchedWeekday = true;
      }
      for (const day of selectedDays) {
        for (const [start, end] of ranges) {
          if (end >= start) continue;
          const nextDay = (day + 1) % 7;
          days[nextDay].push([0, end]);
          touchedWeekday = true;
        }
      }
    }

    if (!touchedWeekday) return null;
    return { hours: days.map(encodeIntervals), holidaysClosed };
  }

  function normalizeOfficialHours(openingHours) {
    if (!openingHours || typeof openingHours !== "object") return null;
    const days = Array(7).fill(null);
    const selectors = {
      "mon-sat": [0, 1, 2, 3, 4, 5],
      sun: [6],
      "mon-sun": [0, 1, 2, 3, 4, 5, 6]
    };
    const keys = Object.keys(openingHours);
    if (keys.some((selector) => !selectors[selector])) return null;

    // The official locator applies the specific Sunday rule after mon-sat.
    // An explicit day clears overnight spill from the earlier, broader rule.
    const orderedSelectors = ["mon-sun", "mon-sat", "sun"].filter((selector) => keys.includes(selector));
    for (const selector of orderedSelectors) {
      const value = openingHours[selector];
      const indices = selectors[selector];
      for (const day of indices) days[day] = [];
      if (value === false || value == null || value === "") {
        continue;
      }
      const range = parseRange(value);
      if (!range) return null;
      // Żabka's locator renders 00:00-00:00 as all day, but the feed uses the
      // same sentinel for stores whose real Sunday hours are shorter or closed.
      // An ambiguous sentinel must therefore remain unknown, never confirmed open.
      if (range[0] === range[1]) {
        for (const day of indices) days[day] = null;
        continue;
      }
      for (const day of indices) {
        days[day].push(range[1] > range[0] ? range : [range[0], 1440]);
      }
      if (range[1] < range[0]) {
        for (const day of indices) {
          const nextDay = (day + 1) % 7;
          if (days[nextDay] === null) days[nextDay] = [];
          days[nextDay].push([0, range[1]]);
        }
      }
    }
    if (!days.some((day) => day !== null)) return null;
    return days.map((intervals) => intervals === null ? null : encodeIntervals(intervals));
  }

  function easterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
  }

  function isoDate(year, month, day) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function shiftedIso(date, days) {
    const shifted = new Date(date.getTime() + days * 86400000);
    return isoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
  }

  function isPolishPublicHoliday(year, month, day) {
    const value = isoDate(year, month, day);
    const fixed = new Set([
      `${year}-01-01`, `${year}-01-06`, `${year}-05-01`, `${year}-05-03`,
      `${year}-08-15`, `${year}-11-01`, `${year}-11-11`, `${year}-12-24`,
      `${year}-12-25`, `${year}-12-26`
    ]);
    if (fixed.has(value)) return true;
    const easter = easterSunday(year);
    return [0, 1, 49, 60].some((offset) => shiftedIso(easter, offset) === value);
  }

  function zonedParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
      weekday: WEEKDAY_INDEX[values.weekday],
      minute: Number(values.hour) * 60 + Number(values.minute) + Number(values.second) / 60
    };
  }

  function formatMinutes(minutes) {
    const normalized = Math.max(0, Math.min(1440, minutes));
    const hour = Math.floor(normalized / 60);
    const minute = Math.floor(normalized % 60);
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  function statusAt(hours, options = {}) {
    if (!Array.isArray(hours) || hours.length !== 7) {
      return { state: "unknown", label: "Godziny niepotwierdzone", badge: "NIEPOTWIERDZONE" };
    }
    const date = options.date instanceof Date ? options.date : new Date();
    const timeZone = options.timeZone || "Europe/Warsaw";
    const parts = zonedParts(date, timeZone);
    if (options.holidaysClosed && isPolishPublicHoliday(parts.year, parts.month, parts.day)) {
      return { state: "closed", label: "Zamknięte — dzień świąteczny", badge: "ZAMKNIĘTE" };
    }

    const encoded = hours[parts.weekday];
    if (encoded == null) return { state: "unknown", label: "Godziny niepotwierdzone", badge: "NIEPOTWIERDZONE" };
    const intervals = decodeIntervals(encoded);
    if (!intervals) return { state: "unknown", label: "Godziny niepotwierdzone", badge: "NIEPOTWIERDZONE" };
    const current = intervals.find(([start, end]) => parts.minute >= start && parts.minute < end);
    if (current) {
      return {
        state: "open",
        label: current[0] === 0 && current[1] === 1440
          ? "Otwarte teraz"
          : `Otwarte · do ${formatMinutes(current[1])}`,
        badge: "OTWARTE"
      };
    }
    return { state: "closed", label: "Zamknięte teraz", badge: "ZAMKNIĘTE" };
  }

  function availabilityStatusAt(hours, options = {}) {
    const status = statusAt(hours, options);
    if (status.state !== "unknown" || options.allowLikelyUnknown !== true) return status;

    const date = options.date instanceof Date ? options.date : new Date();
    const timeZone = options.timeZone || "Europe/Warsaw";
    const { year, month, day, minute } = zonedParts(date, timeZone);
    if (isPolishPublicHoliday(year, month, day)) return status;
    if (minute < LIKELY_OPEN_START || minute >= LIKELY_OPEN_END) return status;

    return {
      state: "likely",
      label: "Prawdopodobnie otwarte · brak godzin",
      badge: "PRAWDOPODOBNIE OTWARTE"
    };
  }

  function rankStores(stores, options = {}) {
    const availability = options.availability === "all" ? "all" : "open";
    const limit = Number.isFinite(options.limit) ? options.limit : 5;
    return stores
      .map((store) => ({
        ...store,
        openingStatus: availabilityStatusAt(store.hours, {
          date: options.date,
          timeZone: options.timeZone,
          holidaysClosed: store.holidaysClosed,
          allowLikelyUnknown: availability === "open" && options.allowLikelyUnknown === true
        })
      }))
      .filter((store) => availability === "all" || ["open", "likely"].includes(store.openingStatus.state))
      .sort((a, b) => {
        const aScore = a.distance + (a.openingStatus.state === "likely" ? LIKELY_OPEN_DISTANCE_PENALTY : 0);
        const bScore = b.distance + (b.openingStatus.state === "likely" ? LIKELY_OPEN_DISTANCE_PENALTY : 0);
        return aScore - bScore || a.distance - b.distance;
      })
      .slice(0, limit);
  }

  return {
    availabilityStatusAt,
    decodeIntervals,
    isPolishPublicHoliday,
    normalizeOfficialHours,
    parseOsmOpeningHours,
    rankStores,
    statusAt
  };
});
