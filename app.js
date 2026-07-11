(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const ui = {
    startCard: $("#startCard"),
    loadingCard: $("#loadingCard"),
    radarCard: $("#radarCard"),
    errorCard: $("#errorCard"),
    startButton: $("#startButton"),
    retryButton: $("#retryButton"),
    refreshButton: $("#refreshButton"),
    routeButton: $("#routeButton"),
    storesButton: $("#storesButton"),
    statusPill: $("#statusPill"),
    loadingTitle: $("#loadingTitle"),
    loadingMessage: $("#loadingMessage"),
    errorTitle: $("#errorTitle"),
    errorMessage: $("#errorMessage"),
    distance: $("#distance"),
    distanceUnit: $("#distanceUnit"),
    directionHint: $("#directionHint"),
    storeName: $("#storeName"),
    storeAddress: $("#storeAddress"),
    storeNumber: $(".store-number"),
    needle: $("#needle"),
    sheet: $("#storeSheet"),
    sheetBackdrop: $("#sheetBackdrop"),
    closeSheet: $("#closeSheet"),
    storeList: $("#storeList"),
    toast: $("#toast"),
    installHintButton: $("#installHintButton"),
    mapsFallbackStart: $("#mapsFallbackStart"),
    mapsFallbackError: $("#mapsFallbackError")
  };

  const CACHE_KEY = "zabhop-stores-v3";
  const SEARCH_AFTER_MS = 5 * 60 * 1000;
  let officialStoreRows = null;
  const state = {
    position: null,
    heading: null,
    compassEnabled: false,
    compassRequested: false,
    stores: [],
    selectedIndex: 0,
    watchId: null,
    started: false,
    searching: false,
    lastSearchAt: 0,
    lastSearchPosition: null,
    arrivalNotified: false,
    wakeLock: null
  };

  function showCard(name) {
    for (const card of [ui.startCard, ui.loadingCard, ui.radarCard, ui.errorCard]) {
      card.classList.add("hidden");
    }
    ui[name].classList.remove("hidden");
  }

  function setStatus(label, kind = "ready") {
    ui.statusPill.classList.toggle("busy", kind === "busy");
    ui.statusPill.classList.toggle("error", kind === "error");
    ui.statusPill.querySelector(".status-copy").textContent = label;
  }

  function toast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add("show");
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => ui.toast.classList.remove("show"), 3200);
  }

  function normalizeText(value = "") {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function toRadians(value) { return value * Math.PI / 180; }
  function toDegrees(value) { return value * 180 / Math.PI; }
  function normalizeDegrees(value) { return ((value % 360) + 360) % 360; }
  function signedAngle(value) { return ((value + 540) % 360) - 180; }

  function distanceBetween(a, b) {
    const radius = 6371000;
    const dLat = toRadians(b.lat - a.lat);
    const dLon = toRadians(b.lon - a.lon);
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function bearingBetween(a, b) {
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);
    const dLon = toRadians(b.lon - a.lon);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return normalizeDegrees(toDegrees(Math.atan2(y, x)));
  }

  function formatDistance(meters) {
    if (meters < 1000) {
      const rounded = meters < 100 ? Math.max(1, Math.round(meters)) : Math.round(meters / 10) * 10;
      return [String(rounded), "m"];
    }
    return [(meters / 1000).toFixed(meters < 10000 ? 1 : 0).replace(".", ","), "km"];
  }

  function buildAddress(properties) {
    const street = properties.street || properties.locality || properties.district || "";
    const number = properties.housenumber || "";
    const city = properties.city || properties.town || properties.village || "";
    const first = [street, number].filter(Boolean).join(" ");
    return [first, city].filter((value, index, array) => value && array.indexOf(value) === index).join(", ") || "Adres dostępny w Mapach";
  }

  function dedupeAndSort(stores, position) {
    const exact = stores.filter((store) => normalizeText(store.name).includes("zabka"));
    const candidates = exact.length ? exact : stores;
    const unique = [];
    for (const store of candidates) {
      if (!Number.isFinite(store.lat) || !Number.isFinite(store.lon)) continue;
      if (unique.some((other) => distanceBetween(store, other) < 20)) continue;
      unique.push(store);
    }
    return unique
      .map((store) => ({ ...store, distance: distanceBetween(position, store) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5);
  }

  async function fetchJSON(url, timeoutMs = 11000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function searchPhoton(position) {
    const lat = position.lat.toFixed(3);
    const lon = position.lon.toFixed(3);
    const params = new URLSearchParams({
      q: "Żabka",
      lat,
      lon,
      limit: "30",
      countrycode: "PL",
      osm_tag: "shop:convenience",
      location_bias_scale: "0"
    });
    const data = await fetchJSON(`https://photon.komoot.io/api/?${params}`);
    return (data.features || []).map((feature) => {
      const properties = feature.properties || {};
      const coordinates = feature.geometry?.coordinates || [];
      return {
        id: `photon-${properties.osm_type || "x"}-${properties.osm_id || coordinates.join("-")}`,
        name: properties.name || properties.brand || "Żabka",
        address: buildAddress(properties),
        lat: Number(coordinates[1]),
        lon: Number(coordinates[0])
      };
    });
  }

  async function searchOfficial(position) {
    if (!officialStoreRows) {
      officialStoreRows = await fetchJSON("./stores.json", 15000);
    }

    const latitudeWindow = 0.24;
    const longitudeWindow = 0.34;
    return officialStoreRows
      .filter((row) => Math.abs(Number(row[1]) - position.lat) < latitudeWindow && Math.abs(Number(row[2]) - position.lon) < longitudeWindow)
      .map((row) => ({
        id: `official-${row[0]}`,
        name: "Żabka",
        address: [row[3], row[4]].filter(Boolean).join(", "),
        lat: Number(row[1]),
        lon: Number(row[2])
      }));
  }

  async function searchOverpass(position) {
    const query = `[out:json][timeout:10];(nwr(around:12000,${position.lat},${position.lon})["name"~"Żabka|Zabka",i];nwr(around:12000,${position.lat},${position.lon})["brand"~"Żabka|Zabka",i];);out center tags 40;`;
    const endpoints = [
      "https://overpass.kumi.systems/api/interpreter",
      "https://overpass-api.de/api/interpreter"
    ];
    let lastError;
    for (const endpoint of endpoints) {
      try {
        const data = await fetchJSON(`${endpoint}?data=${encodeURIComponent(query)}`, 9000);
        return (data.elements || []).map((element) => {
          const tags = element.tags || {};
          return {
            id: `osm-${element.type}-${element.id}`,
            name: tags.name || tags.brand || "Żabka",
            address: buildAddress({
              street: tags["addr:street"] || tags["addr:place"],
              housenumber: tags["addr:housenumber"],
              city: tags["addr:city"]
            }),
            lat: Number(element.lat ?? element.center?.lat),
            lon: Number(element.lon ?? element.center?.lon)
          };
        });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Overpass unavailable");
  }

  function readCachedStores(position) {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (!cached?.stores?.length || !cached.position || Date.now() - cached.savedAt > 24 * 60 * 60 * 1000) return [];
      if (distanceBetween(position, cached.position) > 8000) return [];
      return dedupeAndSort(cached.stores, position);
    } catch (_) {
      return [];
    }
  }

  function saveCachedStores(position, stores) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), position, stores }));
    } catch (_) { /* Private browsing can disable storage. */ }
  }

  async function findStores(force = false) {
    if (!state.position || state.searching) return;
    if (!force && state.lastSearchPosition && Date.now() - state.lastSearchAt < SEARCH_AFTER_MS && distanceBetween(state.position, state.lastSearchPosition) < 500) return;

    state.searching = true;
    setStatus("SZUKAM", "busy");
    if (!state.stores.length) {
      showCard("loadingCard");
      ui.loadingTitle.textContent = "Wypatruję Żabek…";
      ui.loadingMessage.textContent = "Sprawdzam sklepy najbliżej Ciebie.";
    }

    const cached = readCachedStores(state.position);
    if (!state.stores.length && cached.length) {
      state.stores = cached;
      state.selectedIndex = 0;
      renderRadar();
    }

    let rawStores = [];
    let networkError = null;
    try {
      rawStores = await searchOfficial(state.position);
      let sorted = dedupeAndSort(rawStores, state.position);
      if (!sorted.length) {
        rawStores = await searchPhoton(state.position);
        sorted = dedupeAndSort(rawStores, state.position);
      }
      if (!sorted.length) {
        rawStores = await searchOverpass(state.position);
        sorted = dedupeAndSort(rawStores, state.position);
      }
      if (!sorted.length) throw new Error("empty");
      state.stores = sorted;
      state.selectedIndex = 0;
      state.lastSearchAt = Date.now();
      state.lastSearchPosition = { ...state.position };
      saveCachedStores(state.position, rawStores);
      renderRadar();
    } catch (error) {
      networkError = error;
    } finally {
      state.searching = false;
    }

    if (networkError && !state.stores.length) {
      showError(
        networkError.message === "empty" ? "Nie widzę Żabki w pobliżu" : "Sklepy schowały się w chmurach",
        "Połączenie z bazą sklepów nie odpowiedziało. Możesz ponowić albo od razu otworzyć Żabki w Mapach."
      );
    } else if (networkError) {
      toast("Pokazuję ostatnio znalezione sklepy");
      setStatus("OFFLINE", "error");
    }
  }

  function renderRadar() {
    const store = state.stores[state.selectedIndex];
    if (!store || !state.position) return;
    store.distance = distanceBetween(state.position, store);
    const [value, unit] = formatDistance(store.distance);
    ui.distance.textContent = value;
    ui.distanceUnit.textContent = unit;
    ui.storeName.textContent = store.name || "Żabka";
    ui.storeAddress.textContent = store.address || "Adres dostępny w Mapach";
    ui.storeNumber.textContent = String(state.selectedIndex + 1).padStart(2, "0");

    const targetBearing = bearingBetween(state.position, store);
    const deviceHeading = state.heading ?? 0;
    ui.needle.style.transform = `rotate(${normalizeDegrees(targetBearing - deviceHeading)}deg)`;

    if (store.distance < 35) {
      ui.radarCard.classList.add("arrived");
      ui.directionHint.textContent = "JESTEŚ NA MIEJSCU!";
      if (!state.arrivalNotified) {
        state.arrivalNotified = true;
        toast("Hop! Jesteś przy Żabce 🐸");
        if (navigator.vibrate) navigator.vibrate([120, 80, 180]);
      }
    } else {
      ui.radarCard.classList.remove("arrived");
      if (store.distance > 65) state.arrivalNotified = false;
      ui.directionHint.textContent = state.compassEnabled
        ? "IDŹ W TYM KIERUNKU"
        : "STRZAŁKA WZGLĘDEM PÓŁNOCY";
    }

    showCard("radarCard");
    setStatus("NA ŻYWO", "ready");
    renderStoreList();
  }

  function renderStoreList() {
    ui.storeList.replaceChildren();
    state.stores.forEach((store, index) => {
      const distance = state.position ? distanceBetween(state.position, store) : store.distance;
      const [value, unit] = formatDistance(distance);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `store-item${index === state.selectedIndex ? " selected" : ""}`;

      const number = document.createElement("span");
      number.className = "store-index";
      number.textContent = String(index + 1);

      const copy = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = store.name || "Żabka";
      const address = document.createElement("small");
      address.textContent = store.address || "Adres dostępny w Mapach";
      copy.append(name, address);

      const meters = document.createElement("span");
      meters.className = "meters";
      meters.textContent = `${value} ${unit}`;

      button.append(number, copy, meters);
      button.addEventListener("click", () => {
        state.selectedIndex = index;
        state.arrivalNotified = false;
        closeSheet();
        renderRadar();
      });
      ui.storeList.append(button);
    });
  }

  function smoothHeading(next) {
    if (!Number.isFinite(next)) return;
    if (state.heading == null) state.heading = normalizeDegrees(next);
    else state.heading = normalizeDegrees(state.heading + signedAngle(next - state.heading) * 0.24);
  }

  function handleOrientation(event) {
    let next = null;
    if (Number.isFinite(event.webkitCompassHeading)) next = event.webkitCompassHeading;
    else if (event.absolute && Number.isFinite(event.alpha)) next = normalizeDegrees(360 - event.alpha);
    if (next == null) return;
    state.compassEnabled = true;
    smoothHeading(next);
    if (state.stores.length) renderRadar();
  }

  function enableOrientationEvents() {
    if (state.compassRequested) return;
    state.compassRequested = true;
    window.addEventListener("deviceorientationabsolute", handleOrientation, true);
    window.addEventListener("deviceorientation", handleOrientation, true);
  }

  function requestCompassFromGesture() {
    if (typeof window.DeviceOrientationEvent === "undefined") return Promise.resolve("unsupported");
    if (typeof window.DeviceOrientationEvent.requestPermission === "function") {
      return window.DeviceOrientationEvent.requestPermission().catch(() => "denied");
    }
    return Promise.resolve("granted");
  }

  function handlePosition(position) {
    const coords = position.coords;
    state.position = { lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy };
    if (!state.compassEnabled && Number.isFinite(coords.heading) && (coords.speed || 0) > 0.6) {
      smoothHeading(coords.heading);
    }
    if (state.stores.length) {
      renderRadar();
      void findStores(false);
    } else {
      void findStores(true);
    }
  }

  function handleLocationError(error) {
    const messages = {
      1: ["Lokalizacja jest wyłączona", "W ustawieniach Safari zezwól tej stronie na lokalizację, a potem spróbuj ponownie."],
      2: ["Nie mogę ustalić pozycji", "Wyjdź w miejsce z lepszym zasięgiem GPS albo otwórz Żabki w Mapach."],
      3: ["GPS potrzebuje więcej czasu", "Spróbuj jeszcze raz — czasem pierwszy odczyt na iPhonie trwa kilkanaście sekund."]
    };
    const [title, message] = messages[error.code] || ["Żaba zgubiła trop", "Nie udało się pobrać lokalizacji."];
    showError(title, message);
  }

  function startLocationWatch() {
    if (!navigator.geolocation) {
      showError("Ta przeglądarka nie udostępnia GPS", "Otwórz stronę w Safari albo użyj przycisku Mapy.");
      return;
    }
    if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId);
    state.watchId = navigator.geolocation.watchPosition(handlePosition, handleLocationError, {
      enableHighAccuracy: true,
      timeout: 18000,
      maximumAge: 4000
    });
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    try { state.wakeLock = await navigator.wakeLock.request("screen"); } catch (_) { /* Optional. */ }
  }

  function begin() {
    if (state.started) {
      showCard("loadingCard");
      setStatus("GPS", "busy");
      startLocationWatch();
      return;
    }
    state.started = true;
    showCard("loadingCard");
    setStatus("GPS", "busy");
    ui.loadingTitle.textContent = "Łapię Twój trop…";
    ui.loadingMessage.textContent = "Zezwól Safari na lokalizację i kompas.";

    const compassPermission = requestCompassFromGesture();
    startLocationWatch();
    void requestWakeLock();
    compassPermission.then((permission) => {
      if (permission === "granted") enableOrientationEvents();
      else if (permission === "denied") toast("Kompas wyłączony — radar pokaże kierunek względem północy");
    });
  }

  function showError(title, message) {
    ui.errorTitle.textContent = title;
    ui.errorMessage.textContent = message;
    showCard("errorCard");
    setStatus("BRAK SYGNAŁU", "error");
  }

  function openMapsSearch() {
    const near = state.position ? `&near=${state.position.lat},${state.position.lon}` : "";
    window.location.href = `https://maps.apple.com/?q=${encodeURIComponent("Żabka")}${near}`;
  }

  function openRoute() {
    const store = state.stores[state.selectedIndex];
    if (!store) return openMapsSearch();
    const start = state.position ? `saddr=${state.position.lat},${state.position.lon}&` : "";
    window.location.href = `https://maps.apple.com/?${start}daddr=${store.lat},${store.lon}&dirflg=w`;
  }

  function openSheet() {
    renderStoreList();
    ui.sheetBackdrop.classList.remove("hidden");
    ui.sheet.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeSheet() {
    ui.sheetBackdrop.classList.add("hidden");
    ui.sheet.hidden = true;
    document.body.style.overflow = "";
  }

  ui.startButton.addEventListener("click", begin);
  ui.retryButton.addEventListener("click", begin);
  ui.refreshButton.addEventListener("click", () => void findStores(true));
  ui.routeButton.addEventListener("click", openRoute);
  ui.storesButton.addEventListener("click", openSheet);
  ui.closeSheet.addEventListener("click", closeSheet);
  ui.sheetBackdrop.addEventListener("click", closeSheet);
  ui.mapsFallbackStart.addEventListener("click", openMapsSearch);
  ui.mapsFallbackError.addEventListener("click", openMapsSearch);
  ui.installHintButton.addEventListener("click", () => toast("Safari: Udostępnij, potem Dodaj do ekranu początkowego"));

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.started) {
      void requestWakeLock();
      if (state.stores.length) renderRadar();
    }
  });

  if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) {
    ui.installHintButton.classList.add("hidden");
  }

  const demoRequested = new URLSearchParams(window.location.search).get("demo") === "1";
  if (demoRequested && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    state.started = true;
    state.compassEnabled = true;
    state.heading = 18;
    state.position = { lat: 52.20225, lon: 21.02925, accuracy: 6 };
    state.stores = [
      { id: "official-ZG162", name: "Żabka", address: "ul. Dolna 11 lok. U-2, Warszawa", lat: 52.200902, lon: 21.0313 },
      { id: "official-demo-2", name: "Żabka", address: "Wiktorska 7/11, Warszawa", lat: 52.2008698, lon: 21.022411 },
      { id: "official-demo-3", name: "Żabka", address: "Czerniakowska 145, Warszawa", lat: 52.2122607, lon: 21.0466925 },
      { id: "official-demo-4", name: "Żabka", address: "Marszałkowska 10/16, Warszawa", lat: 52.2156017, lon: 21.0207027 },
      { id: "official-demo-5", name: "Żabka", address: "Wielicka 43, Warszawa", lat: 52.187259, lon: 21.0217233 }
    ];
    renderRadar();
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }
})();
