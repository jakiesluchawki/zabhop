export const officialURL = "https://www.zabka.pl/app/uploads/locator-store-data.json";
const retryableStatuses = new Set([403, 408, 425, 429, 500, 502, 503, 504]);
const flag = (value) => typeof value === "string" ? value.toLowerCase() : value;
const isTrue = (value) => flag(value) === true || flag(value) === "true";
const isFalse = (value) => flag(value) === false || flag(value) === "false";
const cleanAddress = (value) => String(value || "")
  .replace(/<br\s*\/?\s*>/gi, " ").replace(/\s+/g, " ").trim();

export function buildOfficialCatalog(official, { previousCount, normalizeHours }) {
  if (!Array.isArray(official)) throw new Error("Official Żabka feed is not an array");
  const current = official.filter((store) => isTrue(store?.active)
    && !isFalse(store?.isVisible) && !isTrue(store?.locatorPlanned));
  const rows = current.map((store) => [
    store.storeId, Number(store.lat), Number(store.lon),
    cleanAddress(store.street), cleanAddress(store.town), normalizeHours(store.openingHours)
  ]);
  const stats = { sourceRows: official.length, candidateRows: rows.length, previousCount };
  const reject = (reason) => { throw new Error(`${reason}; ${JSON.stringify(stats)}`); };
  if (rows.some(([id, lat, lon]) => typeof id !== "string" || !id.trim()
    || !Number.isFinite(lat) || lat < 48 || lat > 56
    || !Number.isFinite(lon) || lon < 13 || lon > 25)) {
    reject("Refusing catalog with invalid IDs or coordinates");
  }
  const uniqueIds = new Set(rows.map((row) => row[0]));
  if (rows.length < 10_000 || uniqueIds.size !== rows.length) {
    reject(`Refusing suspicious catalog: ${rows.length} rows, ${uniqueIds.size} unique IDs`);
  }
  if (rows.length < previousCount * 0.9) reject(`Refusing catalog shrink from ${previousCount} to ${rows.length}`);
  rows.sort((lhs, rhs) => lhs[0].localeCompare(rhs[0], "pl"));
  return { rows, stats };
}

// A successful HTTP response can still contain a partial catalog. Validate inside
// the retry boundary, before the caller is allowed to replace any published files.
export async function fetchOfficialCatalog({
  previousCount, normalizeHours, fetchImpl = fetch,
  retryDelaysMs = [5_000, 15_000, 45_000],
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onRetry = console.warn, now = Date.now, timeoutMs = 30_000
}) {
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    const url = new URL(officialURL);
    if (attempt) url.searchParams.set("_zabhop_retry", `${now()}-${attempt}`);
    let permanentHTTPError = false;
    try {
      const response = await fetchImpl(url.toString(), {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: "application/json",
          Referer: "https://www.zabka.pl/znajdz-sklep/",
          "User-Agent": "ZabHop catalog refresh (https://github.com/jakiesluchawki/zabhop)",
          ...(attempt ? { "Cache-Control": "no-cache", Pragma: "no-cache" } : {})
        }
      });
      if (!response.ok) {
        permanentHTTPError = !retryableStatuses.has(response.status);
        await response.body?.cancel();
        throw new Error(`Official Żabka feed returned HTTP ${response.status}`);
      }
      let official;
      try {
        official = await response.json();
      } catch (error) {
        if (error instanceof SyntaxError) throw new Error("Official Żabka feed returned invalid JSON");
        throw error;
      }
      const result = buildOfficialCatalog(official, { previousCount, normalizeHours });
      return { ...result, attempts: attempt + 1 };
    } catch (error) {
      if (permanentHTTPError || attempt === retryDelaysMs.length) throw error;
      const delay = retryDelaysMs[attempt];
      // Only aggregate validation diagnostics, never raw source records or contacts.
      onRetry(`Official Żabka feed attempt ${attempt + 1} failed: ${error.message}; retrying in ${delay / 1000}s`);
      await sleep(delay);
    }
  }
}
