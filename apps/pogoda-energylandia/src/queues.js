const QUEUE_SOURCE_URL = "https://queue-times.com/en-US/parks/317/queue_times";
const QUEUE_STALE_AFTER_MINUTES = 90;

function normalizeName(value = "") {
  return String(value ?? "")
    .replace(/\s*\(\d+\)\s*$/u, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ł/g, "l")
    .replace(/\brc\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function validTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function validWaitTime(value) {
  if (value === null || value === undefined || value === "") return null;
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}

function rideQuality(ride) {
  const status = ride?.is_open ?? ride?.isOpen;
  return (typeof status === "boolean" ? 4 : 0)
    + (validWaitTime(ride?.wait_time ?? ride?.waitTime) !== null ? 2 : 0)
    + (validTimestamp(ride?.last_updated ?? ride?.lastUpdated) !== null ? 1 : 0);
}

export function queueRidesFromPayload(payload) {
  const topLevel = Array.isArray(payload?.rides) ? payload.rides : [];
  const byLand = Array.isArray(payload?.lands)
    ? payload.lands.flatMap((land) => Array.isArray(land?.rides) ? land.rides : [])
    : [];
  const ridesByIdentity = new Map();

  for (const ride of [...topLevel, ...byLand]) {
    if (!ride || typeof ride !== "object") continue;
    const name = normalizeName(ride.name);
    if (!name) continue;
    const identifier = ride.id !== null && ride.id !== undefined && ride.id !== ""
      ? `id:${ride.id}`
      : `name:${name}`;
    const previous = ridesByIdentity.get(identifier);
    const quality = rideQuality(ride);
    const previousQuality = rideQuality(previous);
    const updatedAt = validTimestamp(ride.last_updated ?? ride.lastUpdated);
    const previousUpdatedAt = validTimestamp(previous?.last_updated ?? previous?.lastUpdated);
    if (
      !previous
      || quality > previousQuality
      || quality === previousQuality && updatedAt !== null && (previousUpdatedAt === null || updatedAt > previousUpdatedAt)
    ) ridesByIdentity.set(identifier, ride);
  }

  return [...ridesByIdentity.values()];
}

function newestTimestamp(rides) {
  return rides.reduce((latest, ride) => {
    const timestamp = validTimestamp(ride.last_updated ?? ride.lastUpdated);
    return timestamp !== null && (latest === null || timestamp > latest) ? timestamp : latest;
  }, null);
}

export function normalizeQueueSnapshot(payload, {
  now = Date.now(),
  staleAfterMinutes = QUEUE_STALE_AFTER_MINUTES,
} = {}) {
  const rides = queueRidesFromPayload(payload);
  if (!rides.length) throw new Error("Kolejki: źródło nie zawiera żadnej rozpoznawalnej atrakcji.");

  const generatedAt = validTimestamp(payload?.snapshot_generated_at ?? payload?.snapshotGeneratedAt);
  const updatedAt = generatedAt ?? newestTimestamp(rides);
  const currentTime = now instanceof Date ? now.getTime() : Number(now);
  const safeNow = Number.isFinite(currentTime) ? currentTime : Date.now();
  const safeStaleMinutes = Number.isFinite(Number(staleAfterMinutes)) && Number(staleAfterMinutes) > 0
    ? Number(staleAfterMinutes)
    : QUEUE_STALE_AFTER_MINUTES;
  const ageMinutes = updatedAt === null ? null : Math.round((safeNow - updatedAt) / 60_000);
  const freshness = updatedAt === null || ageMinutes < -5
    ? "unknown"
    : ageMinutes <= safeStaleMinutes ? "fresh" : "stale";
  const trusted = freshness === "fresh";

  const byName = new Map();
  const qualityByName = new Map();
  rides.forEach((ride) => {
    const name = normalizeName(ride.name);
    const rawStatus = ride.is_open ?? ride.isOpen;
    const reportedIsOpen = typeof rawStatus === "boolean" ? rawStatus : null;
    const reportedWaitTime = validWaitTime(ride.wait_time ?? ride.waitTime);
    const rideUpdatedAt = validTimestamp(ride.last_updated ?? ride.lastUpdated);
    const rideAgeMinutes = rideUpdatedAt === null ? null : Math.round((safeNow - rideUpdatedAt) / 60_000);
    const rideFreshness = !trusted
      ? freshness
      : rideAgeMinutes === null || rideAgeMinutes < -5
        ? "unknown"
        : rideAgeMinutes <= safeStaleMinutes ? "fresh" : "stale";
    const trustedRide = rideFreshness === "fresh";
    const quality = rideQuality(ride);
    const previous = byName.get(name);
    const previousUpdatedAt = validTimestamp(previous?.updatedAt);
    if (
      previous
      && (
        quality < qualityByName.get(name)
        || quality === qualityByName.get(name)
          && (rideUpdatedAt === null || previousUpdatedAt !== null && rideUpdatedAt <= previousUpdatedAt)
      )
    ) return;

    byName.set(name, {
      name: String(ride.name).trim(),
      isOpen: trustedRide ? reportedIsOpen : null,
      waitTime: trustedRide && reportedIsOpen === true ? reportedWaitTime : null,
      reportedIsOpen,
      reportedWaitTime,
      updatedAt: rideUpdatedAt === null ? null : new Date(rideUpdatedAt).toISOString(),
      stale: rideFreshness === "stale",
      freshness: rideFreshness,
      ageMinutes: rideAgeMinutes === null ? null : Math.max(0, rideAgeMinutes),
    });
    qualityByName.set(name, quality);
  });

  return {
    byName,
    updatedAt,
    snapshotGeneratedAt: generatedAt === null ? null : new Date(generatedAt).toISOString(),
    freshness,
    ageMinutes: ageMinutes === null ? null : Math.max(0, ageMinutes),
    sourceUrl: QUEUE_SOURCE_URL,
  };
}

export async function loadQueueTimes(signal) {
  const url = import.meta.env.DEV
    ? "/api/queues"
    : `${import.meta.env.BASE_URL}live-queues.json`;
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Kolejki: HTTP ${response.status}`);
  return normalizeQueueSnapshot(await response.json());
}

export function queueForAttraction(attraction, queues) {
  if (!attraction || !queues?.byName) return null;
  const aliases = [attraction.name, ...(attraction.queueAliases || [])];
  for (const alias of aliases) {
    const match = queues.byName.get(normalizeName(alias));
    if (match) return match;
  }
  const officialNumber = Number(attraction.officialNumber);
  if (!Number.isSafeInteger(officialNumber) || officialNumber < 1) return null;
  const matchingNumbers = [...queues.byName.values()].filter((queue) => {
    const match = String(queue?.name || "").match(/\((\d+)\)\s*$/u);
    return match !== null && Number(match[1]) === officialNumber;
  });
  if (matchingNumbers.length === 1) return matchingNumbers[0];
  return null;
}

export function cautiousWait(waitTime) {
  if (!Number.isFinite(waitTime)) return null;
  if (waitTime === 0) return 0;
  return Math.ceil((waitTime * 1.5) / 5) * 5;
}

export function queueLabel(queue) {
  if (!queue) return "brak danych";
  if (queue.stale) return "dane nieaktualne";
  if (queue.isOpen === false) return "zamknięta";
  if (queue.isOpen !== true) return "status nieznany";
  if (!Number.isFinite(queue.waitTime)) return "brak czasu";
  if (queue.waitTime === 0) return "bez czekania";
  return `${queue.waitTime} min`;
}

export { QUEUE_SOURCE_URL, QUEUE_STALE_AFTER_MINUTES };
