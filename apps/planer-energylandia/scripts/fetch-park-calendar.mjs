import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeParkCalendar, OFFICIAL_PARK_CALENDAR_URL } from "../src/parkCalendar.js";

const endpoint = "https://energylandia.pl/wp-admin/admin-ajax.php?action=get_calendar_json&language=pl";
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const destination = resolve(scriptDirectory, "../public/park-calendar.json");
const temporaryDestination = `${destination}.tmp`;
const checkedAt = new Date().toISOString();

function warsawDateKey(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function offsetDateKey(dateKey, offset) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function unavailableSnapshot() {
  return {
    schemaVersion: 1,
    source: {
      label: "Oficjalny kalendarz Energylandii",
      url: OFFICIAL_PARK_CALENDAR_URL,
      checkedAt: null,
      status: "unavailable",
      timezone: "Europe/Warsaw",
      range: null,
    },
    days: {},
  };
}

async function readPreviousSnapshot() {
  try {
    const snapshot = normalizeParkCalendar(JSON.parse(await readFile(destination, "utf8")));
    return snapshot.source.checkedAt && Object.keys(snapshot.days).length ? snapshot : null;
  } catch {
    return null;
  }
}

async function writeSnapshot(snapshot) {
  await writeFile(temporaryDestination, `${JSON.stringify(snapshot)}\n`, "utf8");
  await rename(temporaryDestination, destination);
}

async function refresh() {
  const previous = await readPreviousSnapshot();

  try {
    const response = await fetch(endpoint, {
      headers: {
        accept: "application/json,text/plain,*/*",
        "accept-language": "pl-PL,pl;q=0.9",
        "user-agent": "PogodaPark/1.0 (+https://jakiesluchawki.github.io/zabhop/planer-energylandia/)",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Nieoczekiwany format oficjalnego kalendarza");
    }

    const today = warsawDateKey();
    const from = offsetDateKey(today, -1);
    const to = offsetDateKey(today, 31);
    const days = Object.fromEntries(
      Object.entries(payload)
        .filter(([dateKey]) => dateKey >= from && dateKey <= to)
        .map(([dateKey, entry]) => [dateKey, {
          date: dateKey,
          status: entry?.status,
          opensAt: entry?.time_od,
          closesAt: entry?.time_do,
          title: entry?.title,
          shows: Array.isArray(entry?.show) ? entry.show : [],
        }]),
    );
    const snapshot = normalizeParkCalendar({
      schemaVersion: 1,
      source: {
        label: "Oficjalny kalendarz Energylandii",
        url: OFFICIAL_PARK_CALENDAR_URL,
        checkedAt,
        status: "fresh",
        timezone: "Europe/Warsaw",
        range: { from, to },
      },
      days,
    });

    if (Object.keys(snapshot.days).length < 3 || !snapshot.days[today]) {
      throw new Error("Oficjalny kalendarz nie potwierdza dzisiejszej daty lub kolejnych dni");
    }

    await writeSnapshot(snapshot);
    console.log(
      `Zapisano ${destination}: ${Object.keys(snapshot.days).length} dni, dziś ${snapshot.days[today].status}.`,
    );
  } catch (error) {
    if (previous) {
      console.warn(`Nie odświeżono oficjalnego kalendarza (${error.message}); zachowuję poprzednią migawkę.`);
      return;
    }

    await writeSnapshot(unavailableSnapshot());
    console.warn(
      `Nie odświeżono oficjalnego kalendarza (${error.message}); publikuję uczciwy status „niepotwierdzone”.`,
    );
  }
}

try {
  await refresh();
} finally {
  await unlink(temporaryDestination).catch(() => {});
}
