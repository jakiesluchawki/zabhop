const FALLBACK_RELEASE = "dev";
const UPDATE_STORAGE_KEY = "pogodapark:last-release-reload";
const RELOAD_GUARD_MS = 30_000;
const RELEASE_CHECK_INTERVAL_MS = 5 * 60_000;

export const APP_RELEASE = typeof __APP_RELEASE__ === "string"
  ? __APP_RELEASE__
  : FALLBACK_RELEASE;

export function normalizedRelease(value) {
  const release = String(value ?? "").trim().toLowerCase();
  return /^[a-f0-9]{7,40}$/.test(release) ? release.slice(0, 12) : null;
}

export function withReleaseQuery(href, release = APP_RELEASE) {
  const url = new URL(href);
  const normalized = normalizedRelease(release);
  if (!normalized) return url.toString();

  const retainedQuery = url.search.slice(1)
    .split("&")
    .filter(Boolean)
    .filter((part) => !/^r[a-f0-9]{7,40}=?$/i.test(part));
  url.search = `?${[...retainedQuery, `r${normalized}`].join("&")}`;
  return url.toString();
}

function accessibleSessionStorage() {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function reloadWasRecent(storage, nextRelease, now) {
  if (!storage) return false;
  try {
    const previous = JSON.parse(storage.getItem(UPDATE_STORAGE_KEY) || "null");
    if (previous?.release === nextRelease && now - Number(previous.at) < RELOAD_GUARD_MS) {
      return true;
    }
    storage.setItem(UPDATE_STORAGE_KEY, JSON.stringify({ release: nextRelease, at: now }));
  } catch {
    // Safari private mode can deny sessionStorage. Updating still remains safe.
  }
  return false;
}

export async function checkForAppUpdate({
  release = APP_RELEASE,
  fetchImpl = globalThis.fetch,
  locationRef = typeof window === "undefined" ? null : window.location,
  storage = accessibleSessionStorage(),
  now = Date.now(),
} = {}) {
  const currentRelease = normalizedRelease(release);
  if (!currentRelease || !locationRef?.href || typeof fetchImpl !== "function") {
    return { state: "disabled", release: currentRelease };
  }

  try {
    const endpoint = new URL("./release.json", locationRef.href);
    endpoint.searchParams.set("check", String(now));
    const response = await fetchImpl(endpoint.toString(), { cache: "no-store" });
    if (!response?.ok) return { state: "unavailable", release: currentRelease };
    const nextRelease = normalizedRelease((await response.json())?.release);
    if (!nextRelease) return { state: "unavailable", release: currentRelease };
    if (nextRelease === currentRelease) return { state: "current", release: currentRelease };
    if (reloadWasRecent(storage, nextRelease, now)) {
      return { state: "throttled", release: nextRelease };
    }

    locationRef.replace(withReleaseQuery(locationRef.href, nextRelease));
    return { state: "updating", release: nextRelease };
  } catch {
    // A temporary network failure must never interrupt a usable park itinerary.
    return { state: "unavailable", release: currentRelease };
  }
}

export function startAppUpdateChecks({
  release = APP_RELEASE,
  windowRef = typeof window === "undefined" ? null : window,
  documentRef = typeof document === "undefined" ? null : document,
  check = checkForAppUpdate,
} = {}) {
  if (!normalizedRelease(release) || !windowRef || !documentRef) return () => {};

  let inFlight = null;
  const refresh = () => {
    if (documentRef.visibilityState === "hidden" || inFlight) return inFlight;
    inFlight = Promise.resolve(check({ release }))
      .catch(() => null)
      .finally(() => { inFlight = null; });
    return inFlight;
  };
  const foreground = () => {
    if (documentRef.visibilityState !== "hidden") refresh();
  };

  refresh();
  windowRef.addEventListener("pageshow", foreground);
  documentRef.addEventListener("visibilitychange", foreground);
  const timer = windowRef.setInterval(foreground, RELEASE_CHECK_INTERVAL_MS);

  return () => {
    windowRef.removeEventListener("pageshow", foreground);
    documentRef.removeEventListener("visibilitychange", foreground);
    windowRef.clearInterval(timer);
  };
}
