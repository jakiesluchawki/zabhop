const QUEUE_SOURCE_URL = "https://queue-times.com/en-US/parks/317/queue_times";

function normalizeName(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ł/g, "l")
    .replace(/\brc\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function newestTimestamp(rides) {
  return rides.reduce((latest, ride) => {
    const timestamp = Date.parse(ride.last_updated || ride.lastUpdated || "");
    return Number.isFinite(timestamp) && timestamp > latest ? timestamp : latest;
  }, 0);
}

export async function loadQueueTimes(signal) {
  const url = import.meta.env.DEV
    ? "/api/queues"
    : `${import.meta.env.BASE_URL}live-queues.json`;
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Kolejki: HTTP ${response.status}`);
  const payload = await response.json();
  const rides = Array.isArray(payload.rides)
    ? payload.rides
    : payload.lands?.flatMap((land) => land.rides || []) || [];
  const byName = new Map();
  rides.forEach((ride) => {
    byName.set(normalizeName(ride.name), {
      name: ride.name?.trim() || "Atrakcja",
      isOpen: ride.is_open ?? ride.isOpen ?? false,
      waitTime: Number.isFinite(Number(ride.wait_time ?? ride.waitTime))
        ? Number(ride.wait_time ?? ride.waitTime)
        : null,
      updatedAt: ride.last_updated || ride.lastUpdated || null,
    });
  });
  return {
    byName,
    updatedAt: newestTimestamp(rides) || Date.now(),
    sourceUrl: QUEUE_SOURCE_URL,
  };
}

export function queueForAttraction(attraction, queues) {
  if (!attraction || !queues?.byName) return null;
  const aliases = [attraction.name, ...(attraction.queueAliases || [])];
  for (const alias of aliases) {
    const match = queues.byName.get(normalizeName(alias));
    if (match) return match;
  }
  return null;
}

export function cautiousWait(waitTime) {
  if (!Number.isFinite(waitTime)) return null;
  if (waitTime === 0) return 0;
  return Math.ceil((waitTime * 1.5) / 5) * 5;
}

export function queueLabel(queue) {
  if (!queue) return "brak danych";
  if (!queue.isOpen) return "zamknięta";
  if (!Number.isFinite(queue.waitTime)) return "brak czasu";
  if (queue.waitTime === 0) return "bez czekania";
  return `${queue.waitTime} min`;
}

export { QUEUE_SOURCE_URL };
