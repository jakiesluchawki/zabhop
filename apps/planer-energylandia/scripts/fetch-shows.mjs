import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseShowDetail, parseShowIndex } from "./show-parser.mjs";

const indexUrl = "https://energylandia.pl/show/";
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const destination = resolve(scriptDirectory, "../public/live-shows.json");
const temporaryDestination = `${destination}.tmp`;
const checkedAt = new Date().toISOString();
const userAgent = "PogodaPark/1.0 (+https://jakiesluchawki.github.io/zabhop/planer-energylandia/)";

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function fetchText(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "accept-language": "pl-PL,pl;q=0.9",
          "user-agent": userAgent,
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      if (html.length < 1_000) throw new Error("Odpowiedź HTML jest podejrzanie krótka");
      return html;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 500);
    }
  }
  throw lastError;
}

async function readPreviousSnapshot() {
  try {
    return JSON.parse(await readFile(destination, "utf8"));
  } catch {
    return null;
  }
}

async function retainPreviousSnapshot(message, previousSnapshot) {
  if (Array.isArray(previousSnapshot?.shows) && previousSnapshot.shows.length) {
    console.warn(`${message}; zachowuję poprzednią migawkę ${destination}.`);
    return;
  }
  throw new Error(`${message}; brak poprawnej poprzedniej migawki.`);
}

function scheduleRange(shows) {
  const dates = shows.flatMap((show) => show.schedule?.map((entry) => entry.date) ?? []).sort();
  return dates.length ? { from: dates[0], to: dates.at(-1) } : null;
}

async function refresh() {
  const previous = await readPreviousSnapshot();
  let indexHtml;
  try {
    indexHtml = await fetchText(indexUrl);
  } catch (error) {
    await retainPreviousSnapshot(`Nie udało się pobrać oficjalnego indeksu pokazów (${error.message})`, previous);
    return;
  }

  const indexShows = parseShowIndex(indexHtml, indexUrl);
  if (indexShows.length < 3) {
    await retainPreviousSnapshot(`Parser znalazł tylko ${indexShows.length} stron pokazów`, previous);
    return;
  }
  const previousIndexCount = Number(previous?.source?.indexCount) || previous?.shows?.length || 0;
  if (previousIndexCount >= 3 && indexShows.length < Math.ceil(previousIndexCount * 0.6)) {
    await retainPreviousSnapshot(
      `Oficjalny indeks skurczył się podejrzanie z ${previousIndexCount} do ${indexShows.length} pozycji`,
      previous,
    );
    return;
  }

  const parsed = [];
  const failures = [];
  const concurrency = 4;
  for (let offset = 0; offset < indexShows.length; offset += concurrency) {
    const batch = indexShows.slice(offset, offset + concurrency);
    const results = await Promise.allSettled(batch.map(async (show) => {
      const html = await fetchText(show.url);
      return {
        ...parseShowDetail(html, {
          url: show.url,
          fallbackImageUrl: show.imageUrl,
          referenceDate: checkedAt,
        }),
        checkedAt,
        stale: false,
      };
    }));
    results.forEach((result, index) => {
      if (result.status === "fulfilled") parsed.push(result.value);
      else failures.push({ url: batch[index].url, message: result.reason?.message || "Nieznany błąd" });
    });
  }

  const minimumFreshDetails = Math.max(3, Math.ceil(indexShows.length * 0.6));
  if (parsed.length < minimumFreshDetails || !parsed.some((show) => show.completeForScheduling)) {
    await retainPreviousSnapshot(
      `Odświeżenie jest niepełne (${parsed.length}/${indexShows.length} stron; wymagane ${minimumFreshDetails})`,
      previous,
    );
    return;
  }

  const currentUrls = new Set(indexShows.map((show) => show.url));
  const parsedUrls = new Set(parsed.map((show) => show.url));
  const retained = (previous?.shows ?? [])
    .filter((show) => currentUrls.has(show.url) && !parsedUrls.has(show.url))
    .map((show) => ({ ...show, stale: true }));
  const shows = [...parsed, ...retained].sort((a, b) => a.title.localeCompare(b.title, "pl"));
  const payload = {
    schemaVersion: 1,
    source: {
      label: "Oficjalne strony pokazów Energylandii",
      url: indexUrl,
      checkedAt,
      timezone: "Europe/Warsaw",
      status: failures.length ? "partial" : "fresh",
      indexCount: indexShows.length,
      refreshedCount: parsed.length,
      retainedStaleCount: retained.length,
      scheduleRange: scheduleRange(shows),
      note: "Godziny mogą zmienić się operacyjnie; przed pokazem sprawdź również tablice na miejscu.",
    },
    shows,
    failures,
  };

  await writeFile(temporaryDestination, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temporaryDestination, destination);
  console.log(
    `Zapisano ${destination}: ${shows.length} pokazów, ${shows.filter((show) => show.completeForScheduling).length} kompletnych do planowania.`,
  );
}

try {
  await refresh();
} finally {
  await unlink(temporaryDestination).catch(() => {});
}
