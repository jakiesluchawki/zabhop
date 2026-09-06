import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";

export const PUBLIC_APP_URL = "https://jakiesluchawki.github.io/zabhop/planer-energylandia/";
const PUBLIC_ORIGIN = new URL(PUBLIC_APP_URL).origin;
const SHORTLINK_ORIGIN = "https://energylandia-shortlinks.mieszko-93c.workers.dev";
const SNAPSHOT_FILES = new Set(["live-queues.json", "live-shows.json", "park-calendar.json"]);
const PDF = registerPlugin("PogodaParkPDF");

export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

// Sharing always leaves the recipient on the public app, never on the
// capacitor://localhost address that exists only inside this installation.
export function publicShareHref(href, native = isNativeApp()) {
  try {
    const url = new URL(href);
    if (!native && ["https:", "http:"].includes(url.protocol)) return url.toString();
  } catch {
    // A missing location is also possible in a native preview.
  }
  return PUBLIC_APP_URL;
}

export async function loadLiveSnapshot(file, {
  signal,
  native = isNativeApp(),
  fetchImpl = globalThis.fetch,
  baseUrl = import.meta.env?.BASE_URL || "./",
  timeoutMs = 12_000,
} = {}) {
  if (!SNAPSHOT_FILES.has(file)) throw new Error("Nieznany plik danych parku");
  const bundledUrl = `${baseUrl}${file}`;
  const read = async (url, requestSignal) => {
    const response = await fetchImpl(url, { signal: requestSignal, cache: "no-store" });
    if (!response.ok) throw new Error(`Dane parku: HTTP ${response.status}`);
    return response.json();
  };
  if (!native) return read(bundledUrl, signal);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, timeoutMs);
  try {
    return await read(new URL(file, PUBLIC_APP_URL).toString(), controller.signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    // An offline installation remains useful. Keep the original timestamp:
    // the existing freshness checks must never treat bundled data as live.
    return await read(bundledUrl, signal);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export async function fetchShortLink(url, init = {}, {
  native = isNativeApp(),
  fetchImpl = globalThis.fetch,
  nativeRequest = (options) => CapacitorHttp.request(options),
} = {}) {
  if (!native) return fetchImpl(url, init);
  const endpoint = new URL(url);
  const method = String(init.method || "GET").toUpperCase();
  if (endpoint.origin !== SHORTLINK_ORIGIN
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || !((method === "POST" && endpoint.pathname === "/plans")
      || (method === "GET" && /^\/plans\/[A-Za-z0-9_-]{16}$/.test(endpoint.pathname)))) {
    throw new Error("Nieobsługiwany adres usługi krótkich linków");
  }
  const response = await nativeRequest({
    url: endpoint.toString(),
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: PUBLIC_ORIGIN,
    },
    ...(init.body ? { data: JSON.parse(init.body) } : {}),
    responseType: "json",
    connectTimeout: 12_000,
    readTimeout: 12_000,
    disableRedirects: true,
  });
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: async () => typeof response.data === "string" ? JSON.parse(response.data) : response.data,
  };
}

export async function copyUrl(url) {
  if (isNativeApp()) {
    const { Clipboard } = await import("@capacitor/clipboard");
    await Clipboard.write({ string: url });
  } else {
    await navigator.clipboard.writeText(url);
  }
}

export async function shareUrl(url) {
  if (isNativeApp()) {
    const { Share } = await import("@capacitor/share");
    try {
      await Share.share({ url });
    } catch (error) {
      if (/cancelled|canceled/i.test(String(error?.message || ""))) {
        throw new DOMException("Share cancelled", "AbortError");
      }
      throw error;
    }
    return "shared";
  }
  if (navigator.share) {
    await navigator.share({ url });
    return "shared";
  }
  await copyUrl(url);
  return "copied";
}

export async function printPlan() {
  if (isNativeApp()) return PDF.exportPDF();
  window.print();
}

export function nativeLocationError(error) {
  const pluginCode = String(error?.code || "");
  const code = ["OS-PLUG-GLOC-0003", "OS-PLUG-GLOC-0008"].includes(pluginCode)
    ? 1 : pluginCode === "OS-PLUG-GLOC-0010" ? 3 : 2;
  return { code, message: String(error?.message || "Nie udało się ustalić lokalizacji") };
}

export function createNativeGeolocation(loadPlugin = async () => ({ geolocation: (await import("@capacitor/geolocation")).Geolocation })) {
  let nextWatch = 0;
  const watches = new Map();
  let pendingPermission = null;
  const permittedPlugin = async (requestPermission = true) => {
    // Capacitor plugins are dynamic proxies: even `then` looks like a method.
    // Never resolve a Promise with that proxy, or Promise assimilation waits
    // forever for a non-existent native `then`. Keep it inside a plain object.
    const loaded = await loadPlugin();
    const plugin = loaded.geolocation ?? loaded;
    let permission = await plugin.checkPermissions();
    if (permission.location === "prompt" || permission.location === "prompt-with-rationale") {
      if (!pendingPermission && requestPermission) {
        pendingPermission = plugin.requestPermissions({ permissions: ["location"] });
        pendingPermission.finally(() => { pendingPermission = null; }).catch(() => {});
      }
      // Resume reuses existing consent or a dialog already opened by the user.
      if (pendingPermission) permission = await pendingPermission;
    }
    if (permission.location !== "granted") {
      throw Object.assign(new Error("Brak zgody na lokalizację"), { code: "OS-PLUG-GLOC-0003" });
    }
    return { plugin };
  };
  return {
    getCurrentPosition(success, failure, options) {
      const { requestPermission = true, ...positionOptions } = options || {};
      permittedPlugin(requestPermission)
        .then(({ plugin }) => plugin.getCurrentPosition(positionOptions))
        .then(success, (error) => failure?.(nativeLocationError(error)));
    },
    watchPosition(success, failure, options) {
      const { requestPermission = true, ...positionOptions } = options || {};
      const id = ++nextWatch;
      const state = { cancelled: false, plugin: null, nativeId: null };
      watches.set(id, state);
      permittedPlugin(requestPermission).then(async ({ plugin }) => {
        state.plugin = plugin;
        if (state.cancelled) return;
        state.nativeId = await plugin.watchPosition(positionOptions, (position, error) => {
          if (state.cancelled) return;
          if (error) failure?.(nativeLocationError(error));
          else if (position) success(position);
        });
        if (state.cancelled) await plugin.clearWatch({ id: state.nativeId });
      }).catch((error) => {
        watches.delete(id);
        if (!state.cancelled) failure?.(nativeLocationError(error));
      });
      return id;
    },
    clearWatch(id) {
      const state = watches.get(id);
      if (!state) return;
      state.cancelled = true;
      watches.delete(id);
      if (state.nativeId !== null) state.plugin.clearWatch({ id: state.nativeId }).catch(() => {});
    },
  };
}

const nativeGeolocation = createNativeGeolocation();
export function appGeolocation() {
  return isNativeApp() ? nativeGeolocation : globalThis.navigator?.geolocation;
}

export function listenNativeAppState(onChange) {
  if (!isNativeApp()) return () => {};
  let disposed = false;
  let listener = null;
  let events = 0;
  import("@capacitor/app").then(async ({ App }) => {
    listener = await App.addListener("appStateChange", ({ isActive }) => {
      events += 1;
      if (!disposed) onChange(isActive);
    });
    if (disposed) { await listener.remove(); return; }
    const before = events;
    const { isActive } = await App.getState();
    if (!disposed && events === before) onChange(isActive);
  }).catch(() => {});
  return () => {
    disposed = true;
    listener?.remove().catch(() => {});
  };
}
