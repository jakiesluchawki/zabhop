(() => {
  "use strict";

  const { HeadingFilter, unwrapAngle } = window.ZabHopHeading;
  const { parseOsmOpeningHours, rankStores, statusAt } = window.ZabHopStoreHours;
  const { normalizeTheme, themeById, nextTheme } = window.ZabHopTheme;

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
    storeHours: $("#storeHours"),
    storeNumber: $(".store-number"),
    needle: $("#needle"),
    sheet: $("#storeSheet"),
    sheetBackdrop: $("#sheetBackdrop"),
    closeSheet: $("#closeSheet"),
    storeList: $("#storeList"),
    toast: $("#toast"),
    installHintButton: $("#installHintButton"),
    themeButton: $("#themeButton"),
    mapsFallbackStart: $("#mapsFallbackStart"),
    mapsFallbackError: $("#mapsFallbackError"),
    modeButtons: [...document.querySelectorAll("[data-store-mode]")],
    availabilityButtons: [...document.querySelectorAll("[data-availability]")],
    startEyebrow: $("#startEyebrow"),
    radarEyebrow: $("#radarEyebrow"),
    sheetTitle: $("#sheetTitle"),
    sheetEyebrow: $("#sheetEyebrow")
  };

  const CACHE_KEY = "zabhop-stores-v5";
  const THEME_STORAGE_KEY = "zabhop-theme-v1";
  const SEARCH_AFTER_MS = 5 * 60 * 1000;
  const headingFilter = new HeadingFilter();
  let officialStoreRows = null;
  let otherStoreRows = null;

  const modeCopy = {
    zabka: {
      nearest: "NAJBLIŻSZA ŻABKA",
      picker: "Wybierz Żabkę",
      searching: "Wypatruję Żabek…",
      defaultName: "Żabka",
      startButton: "Znajdź najbliższą",
      mapsQuery: "Żabka",
      mapsButton: "Pokaż Żabki w Apple Maps",
      emptyTitle: "Nie widzę Żabki w pobliżu",
      emptyMessage: "Połączenie z bazą sklepów nie odpowiedziało. Możesz ponowić albo od razu otworzyć Żabki w Mapach."
    },
    other: {
      nearest: "NAJBLIŻSZY INNY SKLEP",
      picker: "Wybierz sklep",
      searching: "Wypatruję innych sklepów…",
      defaultName: "Sklep",
      startButton: "Znajdź najbliższy sklep",
      mapsQuery: "supermarket",
      mapsButton: "Pokaż sklepy w Apple Maps",
      emptyTitle: "Inne sklepy się pochowały",
      emptyMessage: "Nie znalazłem teraz innego sklepu. Możesz ponowić albo otworzyć supermarkety w Mapach."
    }
  };

  function savedMode() {
    try { return localStorage.getItem("zabhop-store-mode") === "other" ? "other" : "zabka"; }
    catch (_) { return "zabka"; }
  }

  function savedAvailability() {
    try { return localStorage.getItem("zabhop-availability") === "all" ? "all" : "open"; }
    catch (_) { return "open"; }
  }

  function savedTheme() {
    try { return normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY)); }
    catch (_) { return "rose"; }
  }

  const state = {
    position: null,
    heading: null,
    needleRotation: null,
    compassEnabled: false,
    compassRequested: false,
    orientationSource: null,
    needleFrame: null,
    candidates: [],
    stores: [],
    selectedIndex: 0,
    watchId: null,
    started: false,
    searching: false,
    searchGeneration: 0,
    mode: savedMode(),
    availability: savedAvailability(),
    theme: savedTheme(),
    lastSearchAt: 0,
    lastSearchPosition: null,
    arrivalNotified: false,
    openOnlyEmpty: false,
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

  function applyTheme(themeId, announce = false) {
    const theme = themeById(themeId);
    const next = nextTheme(theme.id);
    state.theme = theme.id;
    document.documentElement.dataset.theme = theme.id;
    ui.themeButton.textContent = theme.shortName;
    ui.themeButton.setAttribute("aria-label", `Motyw: ${theme.name}. Zmień na ${next.name}`);
    ui.themeButton.title = `Motyw: ${theme.name}`;
    try { localStorage.setItem(THEME_STORAGE_KEY, theme.id); } catch (_) { /* Optional preference. */ }
    if (announce) toast(`Motyw: ${theme.name}`);
  }

  function renderModeCopy() {
    const copy = modeCopy[state.mode];
    ui.modeButtons.forEach((button) => {
      const selected = button.dataset.storeMode === state.mode;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    ui.startEyebrow.textContent = copy.nearest;
    ui.radarEyebrow.textContent = copy.nearest;
    ui.sheetTitle.textContent = copy.picker;
    ui.startButton.textContent = copy.startButton;
    ui.mapsFallbackStart.textContent = copy.mapsButton;
    document.querySelector("#compass")?.setAttribute("aria-label", `Kierunek do wybranego celu: ${copy.defaultName}`);
  }

  function renderAvailability() {
    ui.availabilityButtons.forEach((button) => {
      const selected = button.dataset.availability === state.availability;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    ui.sheetEyebrow.textContent = state.availability === "open" ? "OTWARTE NAJBLIŻEJ" : "PIĘĆ NAJBLIŻSZYCH";
  }

  function setAvailability(availability) {
    if (!["open", "all"].includes(availability) || state.availability === availability) return;
    state.availability = availability;
    state.selectedIndex = 0;
    state.arrivalNotified = false;
    state.searchGeneration += 1;
    state.searching = false;
    try { localStorage.setItem("zabhop-availability", availability); } catch (_) { /* Optional preference. */ }
    renderAvailability();

    if (state.position && state.candidates.length) {
      state.stores = dedupeAndSort(state.candidates, state.position, state.mode, state.availability);
      if (state.stores.length) renderRadar();
    }
    if (state.started && state.position) void findStores(true);
  }

  function setStoreMode(mode) {
    if (!modeCopy[mode] || state.mode === mode) return;
    state.mode = mode;
    state.candidates = [];
    state.stores = [];
    state.selectedIndex = 0;
    state.lastSearchAt = 0;
    state.lastSearchPosition = null;
    state.arrivalNotified = false;
    state.searchGeneration += 1;
    state.searching = false;
    try { localStorage.setItem("zabhop-store-mode", mode); } catch (_) { /* Optional preference. */ }
    renderModeCopy();

    if (state.started && state.position) void findStores(true);
  }

  function normalizeText(value = "") {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function toRadians(value) { return value * Math.PI / 180; }
  function toDegrees(value) { return value * 180 / Math.PI; }
  function normalizeDegrees(value) { return ((value % 360) + 360) % 360; }

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

  function dedupeAndSort(stores, position, mode = state.mode, availability = state.availability, date = new Date()) {
    const zabkas = stores.filter((store) => normalizeText(store.name).includes("zabka"));
    const candidates = mode === "zabka"
      ? (zabkas.length ? zabkas : stores)
      : stores.filter((store) => !normalizeText(store.name).includes("zabka"));
    const unique = [];
    for (const store of candidates) {
      if (!Number.isFinite(store.lat) || !Number.isFinite(store.lon)) continue;
      if (unique.some((other) => distanceBetween(store, other) < 20)) continue;
      unique.push(store);
    }
    return rankStores(
      unique.map((store) => ({ ...store, distance: distanceBetween(position, store) })),
      { availability, date, limit: 5 }
    );
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

  async function searchPhoton(position, mode) {
    const lat = position.lat.toFixed(3);
    const lon = position.lon.toFixed(3);
    const params = new URLSearchParams({
      q: modeCopy[mode].mapsQuery,
      lat,
      lon,
      limit: "50",
      countrycode: "PL",
      osm_tag: mode === "zabka" ? "shop:convenience" : "shop:supermarket",
      location_bias_scale: "0"
    });
    const data = await fetchJSON(`https://photon.komoot.io/api/?${params}`);
    return (data.features || []).map((feature) => {
      const properties = feature.properties || {};
      const coordinates = feature.geometry?.coordinates || [];
      return {
        id: `photon-${properties.osm_type || "x"}-${properties.osm_id || coordinates.join("-")}`,
        name: properties.name || properties.brand || modeCopy[mode].defaultName,
        address: buildAddress(properties),
        lat: Number(coordinates[1]),
        lon: Number(coordinates[0]),
        hours: null
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
        lon: Number(row[2]),
        hours: Array.isArray(row[5]) ? row[5] : null
      }));
  }

  async function searchOtherBundled(position) {
    if (!otherStoreRows) {
      otherStoreRows = await fetchJSON("./other-stores.json", 15000);
    }

    const latitudeWindow = 0.24;
    const longitudeWindow = 0.34;
    return otherStoreRows
      .filter((store) => Math.abs(Number(store.lat) - position.lat) < latitudeWindow && Math.abs(Number(store.lon) - position.lon) < longitudeWindow)
      .map((store) => ({
        id: `other-${store.id}`,
        name: store.name || store.chain || "Sklep",
        address: [store.street, store.town].filter(Boolean).join(", ") || "Adres dostępny w Mapach",
        lat: Number(store.lat),
        lon: Number(store.lon),
        hours: Array.isArray(store.hours) ? store.hours : null,
        holidaysClosed: store.holidaysClosed === true
      }));
  }

  async function searchOverpass(position, mode) {
    const query = mode === "zabka"
      ? `[out:json][timeout:10];(nwr(around:12000,${position.lat},${position.lon})["name"~"Żabka|Zabka",i];nwr(around:12000,${position.lat},${position.lon})["brand"~"Żabka|Zabka",i];);out center tags 40;`
      : `[out:json][timeout:10];nwr(around:12000,${position.lat},${position.lon})["shop"~"supermarket|convenience"]["name"];out center tags 80;`;
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
          const parsedHours = parseOsmOpeningHours(tags.opening_hours);
          return {
            id: `osm-${element.type}-${element.id}`,
            name: tags.name || tags.brand || modeCopy[mode].defaultName,
            address: buildAddress({
              street: tags["addr:street"] || tags["addr:place"],
              housenumber: tags["addr:housenumber"],
              city: tags["addr:city"]
            }),
            lat: Number(element.lat ?? element.center?.lat),
            lon: Number(element.lon ?? element.center?.lon),
            hours: parsedHours?.hours || null,
            holidaysClosed: parsedHours?.holidaysClosed === true
          };
        });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Overpass unavailable");
  }

  function cacheKey(mode) { return `${CACHE_KEY}-${mode}`; }

  function readCachedStores(position, mode) {
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey(mode)) || "null");
      if (!cached?.stores?.length || !cached.position || Date.now() - cached.savedAt > 24 * 60 * 60 * 1000) return [];
      if (distanceBetween(position, cached.position) > 8000) return [];
      return cached.stores;
    } catch (_) {
      return [];
    }
  }

  function saveCachedStores(position, stores, mode) {
    try {
      localStorage.setItem(cacheKey(mode), JSON.stringify({ savedAt: Date.now(), position, stores }));
    } catch (_) { /* Private browsing can disable storage. */ }
  }

  async function findStores(force = false) {
    if (!state.position || state.searching) return;
    if (!force && state.lastSearchPosition && Date.now() - state.lastSearchAt < SEARCH_AFTER_MS && distanceBetween(state.position, state.lastSearchPosition) < 500) return;

    const generation = ++state.searchGeneration;
    const mode = state.mode;
    const availability = state.availability;
    const position = { ...state.position };
    const copy = modeCopy[mode];
    state.searching = true;
    setStatus("SZUKAM", "busy");
    if (!state.stores.length) {
      showCard("loadingCard");
      ui.loadingTitle.textContent = copy.searching;
      ui.loadingMessage.textContent = "Sprawdzam sklepy najbliżej Ciebie.";
    }

    const cached = readCachedStores(position, mode);
    if (!state.candidates.length && cached.length) {
      state.candidates = cached;
      const cachedVisible = dedupeAndSort(cached, position, mode, availability);
      if (!state.stores.length && cachedVisible.length) {
        state.stores = cachedVisible;
        state.selectedIndex = 0;
        renderRadar();
      }
    }

    let combinedStores = [];
    let sorted = [];
    let networkError = null;
    const searches = mode === "zabka"
      ? [() => searchOfficial(position), () => searchPhoton(position, mode), () => searchOverpass(position, mode)]
      : [() => searchOtherBundled(position), () => searchPhoton(position, mode), () => searchOverpass(position, mode)];

    for (const search of searches) {
      try {
        const found = await search();
        combinedStores.push(...found);
        sorted = dedupeAndSort(combinedStores, position, mode, availability);
        if (sorted.length) break;
      } catch (error) {
        networkError = error;
      }
    }

    if (generation !== state.searchGeneration || mode !== state.mode || availability !== state.availability) return;

    const resolvedCandidates = combinedStores.length ? combinedStores : cached;
    if (!sorted.length && !combinedStores.length && cached.length) {
      sorted = dedupeAndSort(cached, position, mode, availability);
    }
    if (resolvedCandidates.length) {
      state.candidates = resolvedCandidates;
      saveCachedStores(position, resolvedCandidates, mode);
    }

    if (sorted.length) {
      state.stores = sorted;
      state.selectedIndex = 0;
      state.lastSearchAt = Date.now();
      state.lastSearchPosition = position;
      renderRadar();
    } else if (availability === "open" && resolvedCandidates.length) {
      state.stores = [];
      state.selectedIndex = 0;
      showNoOpenStore();
    } else if (!networkError) {
      networkError = new Error("empty");
    }
    state.searching = false;

    if (networkError && !state.stores.length && !state.openOnlyEmpty) {
      showError(networkError.message === "empty" ? copy.emptyTitle : "Sklepy schowały się w chmurach", copy.emptyMessage);
    } else if (networkError && state.stores.length) {
      toast("Pokazuję ostatnio znalezione sklepy");
      setStatus("OFFLINE", "error");
    }
  }

  function renderRadar() {
    const store = state.stores[state.selectedIndex];
    if (!store || !state.position) return;
    store.distance = distanceBetween(state.position, store);
    store.openingStatus = statusAt(store.hours, { holidaysClosed: store.holidaysClosed });
    const [value, unit] = formatDistance(store.distance);
    ui.distance.textContent = value;
    ui.distanceUnit.textContent = unit;
    ui.storeName.textContent = store.name || modeCopy[state.mode].defaultName;
    ui.storeAddress.textContent = store.address || "Adres dostępny w Mapach";
    ui.storeHours.textContent = store.openingStatus.label;
    ui.storeHours.className = `store-hours ${store.openingStatus.state}`;
    ui.storeNumber.textContent = String(state.selectedIndex + 1).padStart(2, "0");
    ui.storesButton.textContent = storeCountLabel(state.stores.length);
    state.openOnlyEmpty = false;
    ui.retryButton.textContent = "Spróbuj ponownie";

    renderNeedle();

    if (store.distance < 35) {
      ui.radarCard.classList.add("arrived");
      ui.directionHint.textContent = "JESTEŚ NA MIEJSCU!";
      if (!state.arrivalNotified) {
        state.arrivalNotified = true;
        toast(state.mode === "zabka" ? "Hop! Jesteś przy Żabce" : `Hop! Jesteś przy: ${store.name}`);
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

  function renderNeedle() {
    const store = state.stores[state.selectedIndex];
    if (!store || !state.position) return;
    if (store.distance < 35 && state.needleRotation != null) return;

    const targetBearing = bearingBetween(state.position, store);
    const deviceHeading = state.heading ?? 0;
    const targetRotation = normalizeDegrees(targetBearing - deviceHeading);
    state.needleRotation = unwrapAngle(state.needleRotation, targetRotation);
    ui.needle.style.transform = `rotate(${state.needleRotation.toFixed(3)}deg)`;

    if (store.distance >= 35) {
      ui.directionHint.textContent = state.compassEnabled
        ? "IDŹ W TYM KIERUNKU"
        : "STRZAŁKA WZGLĘDEM PÓŁNOCY";
    }
  }

  function scheduleNeedleRender() {
    if (state.needleFrame != null) return;
    state.needleFrame = window.requestAnimationFrame(() => {
      state.needleFrame = null;
      renderNeedle();
    });
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
      name.textContent = store.name || modeCopy[state.mode].defaultName;
      const address = document.createElement("small");
      address.textContent = store.address || "Adres dostępny w Mapach";
      const openingStatus = store.openingStatus || statusAt(store.hours, { holidaysClosed: store.holidaysClosed });
      const hours = document.createElement("small");
      hours.className = `opening-status ${openingStatus.state}`;
      hours.textContent = openingStatus.label;
      copy.append(name, address, hours);

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

  function storeCountLabel(count) {
    if (count === 1) return "1 sklep";
    if (count >= 2 && count <= 4) return `${count} sklepy`;
    return `${count} sklepów`;
  }

  function refreshAvailabilityResults(announce = false) {
    if (!state.position || !state.candidates.length) return;
    const selectedId = state.stores[state.selectedIndex]?.id;
    const previouslySelected = state.stores[state.selectedIndex];
    const nextStores = dedupeAndSort(state.candidates, state.position, state.mode, state.availability);
    if (!nextStores.length) {
      if (state.availability === "open") showNoOpenStore();
      return;
    }
    state.stores = nextStores;
    const retainedIndex = nextStores.findIndex((store) => store.id === selectedId);
    state.selectedIndex = retainedIndex >= 0 ? retainedIndex : 0;
    if (announce && state.availability === "open" && previouslySelected && retainedIndex < 0) {
      toast("Ten sklep właśnie się zamknął — kieruję do następnego");
    }
    renderRadar();
  }

  function smoothHeading(next, accuracy) {
    const filtered = headingFilter.update(next, performance.now() / 1000, accuracy);
    if (filtered == null) return false;
    state.heading = filtered;
    return true;
  }

  function handleOrientation(event) {
    let next = null;
    let accuracy = null;
    if (Number.isFinite(event.webkitCompassHeading)) next = event.webkitCompassHeading;
    else if (event.absolute && Number.isFinite(event.alpha)) next = normalizeDegrees(360 - event.alpha);
    if (next == null) return;

    if (state.orientationSource && state.orientationSource !== event.type) return;
    if (!state.orientationSource) state.orientationSource = event.type;
    if (Number.isFinite(event.webkitCompassAccuracy)) accuracy = event.webkitCompassAccuracy;

    if (!smoothHeading(next, accuracy)) return;
    state.compassEnabled = true;
    if (state.stores.length) scheduleNeedleRender();
  }

  function enableOrientationEvents() {
    if (state.compassRequested) return;
    state.compassRequested = true;
    state.orientationSource = null;
    state.heading = null;
    headingFilter.reset();
    if (typeof window.DeviceOrientationEvent.requestPermission === "function") {
      window.addEventListener("deviceorientation", handleOrientation, true);
    } else {
      window.addEventListener("deviceorientationabsolute", handleOrientation, true);
      window.addEventListener("deviceorientation", handleOrientation, true);
    }
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
    if (state.stores.length) {
      refreshAvailabilityResults(false);
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

  function showNoOpenStore() {
    state.openOnlyEmpty = true;
    ui.errorTitle.textContent = state.mode === "zabka"
      ? "Nie znalazłem potwierdzonej otwartej Żabki"
      : "Nie znalazłem potwierdzonego otwartego sklepu";
    ui.errorMessage.textContent = "Nie zgaduję godzin. Wybierz „Na później”, żeby zobaczyć najbliższe sklepy bez względu na to, czy są teraz czynne.";
    ui.retryButton.textContent = "Pokaż na później";
    showCard("errorCard");
    setStatus("ZAMKNIĘTE", "error");
  }

  function showError(title, message) {
    state.openOnlyEmpty = false;
    ui.errorTitle.textContent = title;
    ui.errorMessage.textContent = message;
    ui.retryButton.textContent = "Spróbuj ponownie";
    showCard("errorCard");
    setStatus("BRAK SYGNAŁU", "error");
  }

  function openMapsSearch() {
    const near = state.position ? `&near=${state.position.lat},${state.position.lon}` : "";
    window.location.href = `https://maps.apple.com/?q=${encodeURIComponent(modeCopy[state.mode].mapsQuery)}${near}`;
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
  ui.retryButton.addEventListener("click", () => {
    if (state.openOnlyEmpty) setAvailability("all");
    else begin();
  });
  ui.refreshButton.addEventListener("click", () => void findStores(true));
  ui.routeButton.addEventListener("click", openRoute);
  ui.storesButton.addEventListener("click", openSheet);
  ui.closeSheet.addEventListener("click", closeSheet);
  ui.sheetBackdrop.addEventListener("click", closeSheet);
  ui.mapsFallbackStart.addEventListener("click", openMapsSearch);
  ui.mapsFallbackError.addEventListener("click", openMapsSearch);
  ui.installHintButton.addEventListener("click", () => toast("Safari: Udostępnij, potem Dodaj do ekranu początkowego"));
  ui.themeButton.addEventListener("click", () => applyTheme(nextTheme(state.theme).id, true));
  ui.modeButtons.forEach((button) => {
    button.addEventListener("click", () => setStoreMode(button.dataset.storeMode));
  });
  ui.availabilityButtons.forEach((button) => {
    button.addEventListener("click", () => setAvailability(button.dataset.availability));
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.started) {
      void requestWakeLock();
      refreshAvailabilityResults(false);
    }
  });

  if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) {
    ui.installHintButton.classList.add("hidden");
  }

  const pageParams = new URLSearchParams(window.location.search);
  const requestedMode = pageParams.get("mode");
  if (modeCopy[requestedMode]) state.mode = requestedMode;
  const requestedAvailability = pageParams.get("availability");
  if (["open", "all"].includes(requestedAvailability)) state.availability = requestedAvailability;
  const requestedTheme = pageParams.get("theme");
  if (requestedTheme) state.theme = normalizeTheme(requestedTheme);
  applyTheme(state.theme);
  renderModeCopy();
  renderAvailability();

  const demoRequested = pageParams.get("demo") === "1";
  if (demoRequested && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    state.started = true;
    state.compassEnabled = true;
    state.heading = 18;
    state.position = { lat: 52.20225, lon: 21.02925, accuracy: 6 };
    state.stores = state.mode === "zabka"
      ? [
          { id: "official-ZG162", name: "Żabka", address: "ul. Dolna 11 lok. U-2, Warszawa", lat: 52.200902, lon: 21.0313, hours: ["360-1380", "360-1380", "360-1380", "360-1380", "360-1380", "360-1380", "480-1260"] },
          { id: "official-demo-2", name: "Żabka", address: "Wiktorska 7/11, Warszawa", lat: 52.2008698, lon: 21.022411, hours: ["0-1440", "0-1440", "0-1440", "0-1440", "0-1440", "0-1440", "0-1440"] },
          { id: "official-demo-3", name: "Żabka", address: "Czerniakowska 145, Warszawa", lat: 52.2122607, lon: 21.0466925, hours: ["420-1320", "420-1320", "420-1320", "420-1320", "420-1380", "420-1380", "540-1200"] },
          { id: "official-demo-4", name: "Żabka", address: "Marszałkowska 10/16, Warszawa", lat: 52.2156017, lon: 21.0207027, hours: ["360-1380", "360-1380", "360-1380", "360-1380", "360-1380", "420-1380", "480-1320"] },
          { id: "official-demo-5", name: "Żabka", address: "Wielicka 43, Warszawa", lat: 52.187259, lon: 21.0217233, hours: ["390-1320", "390-1320", "390-1320", "390-1320", "390-1320", "420-1320", null] }
        ]
      : [
          { id: "other-demo-1", name: "Biedronka", address: "ul. Chełmska 21, Warszawa", lat: 52.20145, lon: 21.0411, hours: ["360-1380", "360-1380", "360-1380", "360-1380", "360-1380", "360-1380", "540-1260"] },
          { id: "other-demo-2", name: "Carrefour Express", address: "ul. Puławska 33, Warszawa", lat: 52.2068, lon: 21.0228, hours: ["0-1440", "0-1440", "0-1440", "0-1440", "0-1440", "0-1440", "0-1440"] },
          { id: "other-demo-3", name: "Lidl", address: "ul. Sobieskiego 74/78, Warszawa", lat: 52.1936, lon: 21.0363, hours: ["360-1320", "360-1320", "360-1320", "360-1320", "360-1320", "360-1320", "540-1200"] },
          { id: "other-demo-4", name: "Stokrotka", address: "ul. Czerniakowska 58, Warszawa", lat: 52.2011, lon: 21.0505, hours: ["420-1260", "420-1260", "420-1260", "420-1260", "420-1260", "420-1260", "600-1080"] },
          { id: "other-demo-5", name: "Dino", address: "Warszawa", lat: 52.1852, lon: 21.0181, hours: ["360-1320", "360-1320", "360-1320", "360-1320", "360-1320", "390-1260", null] }
        ];
    state.candidates = state.stores;
    state.stores = dedupeAndSort(state.candidates, state.position, state.mode, state.availability);
    renderRadar();
  }

  window.setInterval(() => {
    if (state.started && document.visibilityState === "visible") refreshAvailabilityResults(true);
  }, 60 * 1000);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }
})();
