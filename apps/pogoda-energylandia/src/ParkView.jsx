import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  CaretRight,
  Check,
  CheckCircle,
  CloudRain,
  Compass,
  Crosshair,
  Database,
  Footprints,
  Info,
  ListChecks,
  MapPin,
  Sparkle,
  Timer,
  Toilet,
  UsersThree,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { ParkMap } from "./ParkMap.jsx";
import {
  ATTRACTIONS,
  TOILETS,
  ZONES,
} from "./parkData.js";
import {
  buildRoute,
  classifyAttractionForFamily,
  chooseNextStop,
  distanceMeters,
  FAMILY_PROFILE,
  findNearestToilet,
  walkingMinutes,
} from "./parkLogic.js";
import {
  cautiousWait,
  loadQueueTimes,
  queueForAttraction,
  queueLabel,
  QUEUE_SOURCE_URL,
} from "./queues.js";

const COMPLETED_KEY = "pogodapark-completed-v1";
const TOILET_KEY = "pogodapark-last-toilet-v1";
const FAMILY_ATTRACTION_IDS = new Set(
  ATTRACTIONS
    .filter((attraction) => classifyAttractionForFamily(attraction) !== "excluded")
    .map((attraction) => attraction.id),
);

function loadStored(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function locationOf(item) {
  return item?.location || item || null;
}

function asToiletResult(result, origin) {
  if (!result) return { toilet: null, distance: null };
  const toilet = result.toilet || result.item || result;
  const distance = Number.isFinite(result.distance)
    ? result.distance
    : origin && toilet ? distanceMeters(origin, locationOf(toilet)) : null;
  return { toilet, distance };
}

function formatFreshness(timestamp) {
  if (!timestamp) return "brak czasu";
  const minutes = Math.max(0, Math.round((Date.now() - Number(timestamp)) / 60000));
  return minutes < 1 ? "przed chwilą" : `${minutes} min temu`;
}

function restrictionLabel(attraction) {
  const rules = attraction?.restrictions || {};
  if (Number.isFinite(rules.minHeightWithGuardian)) {
    return `od ${rules.minHeightWithGuardian} cm z dorosłym`;
  }
  if (Number.isFinite(rules.minAgeWithGuardian)) {
    if (rules.minAgeWithGuardian === 0) return "bez limitu wieku z dorosłym";
    return `od ${rules.minAgeWithGuardian} lat z dorosłym`;
  }
  return "rodzinnie z dorosłym";
}

function zoneName(zone) {
  return ZONES[zone]?.name || zone;
}

function intensityLabel(intensity) {
  return intensity === "calm" ? "spokojna" : intensity === "high" ? "mocna" : "rodzinna";
}

function weatherNow(weather) {
  const hours = weather?.days?.[weather.today] || [];
  if (!hours.length) return null;
  const currentHour = new Date().getHours();
  const current = hours.find((item) => item.hour >= currentHour) || hours.at(-1);
  const next = hours.filter((item) => item.hour >= currentHour).slice(0, 3);
  const rainRisk = Math.max(...next.map((item) => item.precipProbability || 0), 0);
  return {
    temperature: Number.isFinite(current?.temperature) ? Math.round(current.temperature) : null,
    rainRisk: Math.round(rainRisk),
    rainSoon: rainRisk >= 35 || next.some((item) => (item.precipitation || 0) >= 0.4),
  };
}

function ParkSourcesSheet({ onClose }) {
  const sources = [
    {
      name: "Oficjalna mapa parku 2026",
      detail: "strefy, numery atrakcji, WC i ograniczenia",
      href: "https://energylandia.pl/wp-content/uploads/2024/06/MAPKA_PL_2026.pdf",
    },
    {
      name: "Oficjalne strony atrakcji",
      detail: "wiek, wzrost, opiekun i bieżące opisy",
      href: "https://energylandia.pl/atrakcje/",
    },
    {
      name: "OpenStreetMap",
      detail: "współrzędne atrakcji, ścieżek i toalet",
      href: "https://www.openstreetmap.org/#map=16/50.0003/19.4058",
    },
    {
      name: "Queue-Times",
      detail: "nieoficjalny odczyt statusów i czasów kolejek",
      href: QUEUE_SOURCE_URL,
    },
    {
      name: "Relacje rodzinne 2025–2026",
      detail: "ruch od tyłu parku i ostrożna korekta kolejek",
      href: "https://www.reddit.com/r/Themepark/comments/1tigyka/mini_guide_to_energylandia_2026/",
    },
  ];
  return (
    <div className="sheet-layer">
      <button className="sheet-backdrop" type="button" aria-label="Zamknij źródła" onClick={onClose} />
      <section className="bottom-sheet park-sources-sheet" role="dialog" aria-modal="true" aria-labelledby="park-sources-title">
        <div className="sheet-handle" aria-hidden="true" />
        <header className="sheet-header">
          <div>
            <p className="eyebrow">TRANSPARENTNOŚĆ</p>
            <h2 id="park-sources-title">Skąd jest ta trasa</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Zamknij">
            <X size={22} weight="bold" />
          </button>
        </header>
        <div className="source-list">
          {sources.map((source) => (
            <a className="source-row ok" href={source.href} target="_blank" rel="noreferrer" key={source.name}>
              <CheckCircle size={22} weight="fill" aria-hidden="true" />
              <span><strong>{source.name}</strong><small>{source.detail}</small></span>
              <CaretRight size={18} aria-hidden="true" />
            </a>
          ))}
        </div>
        <p className="sheet-note">To nie jest oficjalna nawigacja Energylandii. GPS, dane społecznościowe i czasy oczekiwania bywają niedokładne; zawsze patrzcie na oznaczenia i komunikaty obsługi.</p>
      </section>
    </div>
  );
}

export function ParkView({ weather }) {
  const [completedIds, setCompletedIds] = useState(() => {
    const stored = loadStored(COMPLETED_KEY, []);
    return Array.isArray(stored) ? stored.filter((id) => FAMILY_ATTRACTION_IDS.has(id)) : [];
  });
  const [queues, setQueues] = useState(null);
  const [queueError, setQueueError] = useState("");
  const [queueRefreshing, setQueueRefreshing] = useState(false);
  const [position, setPosition] = useState(null);
  const [locationStatus, setLocationStatus] = useState("idle");
  const [selectedId, setSelectedId] = useState(null);
  const [focus, setFocus] = useState(null);
  const [mapMode, setMapMode] = useState("route");
  const [sheet, setSheet] = useState(null);
  const [lastToiletAt, setLastToiletAt] = useState(() => Number(window.localStorage.getItem(TOILET_KEY)) || Date.now());
  const watchRef = useRef(null);

  const familyHeight = FAMILY_PROFILE.safeHeightCm;
  const weatherSummary = useMemo(() => weatherNow(weather), [weather]);

  useEffect(() => {
    window.localStorage.setItem(COMPLETED_KEY, JSON.stringify(completedIds));
  }, [completedIds]);

  useEffect(() => () => {
    if (watchRef.current != null) navigator.geolocation?.clearWatch(watchRef.current);
  }, []);

  const refreshQueues = useCallback(async () => {
    const controller = new AbortController();
    setQueueRefreshing(true);
    setQueueError("");
    try {
      setQueues(await loadQueueTimes(controller.signal));
    } catch {
      setQueueError("Czasy chwilowo niedostępne");
    } finally {
      setQueueRefreshing(false);
    }
    return () => controller.abort();
  }, []);

  useEffect(() => {
    refreshQueues();
    const interval = window.setInterval(refreshQueues, 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [refreshQueues]);

  const queueById = useMemo(() => Object.fromEntries(
    ATTRACTIONS.map((attraction) => {
      const queue = queueForAttraction(attraction, queues);
      return [attraction.id, queue ? {
        minutes: queue.waitTime,
        status: queue.isOpen ? "open" : "closed",
      } : null];
    }),
  ), [queues]);

  const route = useMemo(() => buildRoute({
    height: familyHeight,
    age: FAMILY_PROFILE.childAge,
    completedIds,
    queueById,
  }), [familyHeight, completedIds, queueById]);

  const nextStop = useMemo(() => chooseNextStop({
    position,
    height: familyHeight,
    age: FAMILY_PROFILE.childAge,
    completedIds,
    queueById,
  }) || route.find((stop) => stop.familyTier === "primary") || route[0] || null, [position, familyHeight, completedIds, queueById, route]);

  const selectedStop = route.find((stop) => stop.id === selectedId)
    || ATTRACTIONS.find((stop) => stop.id === selectedId)
    || nextStop;
  const currentOrigin = position || locationOf(nextStop);
  const nearest = useMemo(() => asToiletResult(
    findNearestToilet(currentOrigin),
    currentOrigin,
  ), [currentOrigin]);
  const nextQueue = queueForAttraction(nextStop, queues);
  const realWait = cautiousWait(nextQueue?.waitTime);
  const nextDistance = position && nextStop
    ? distanceMeters(position, locationOf(nextStop))
    : Number(nextStop?.distanceFromPreviousMeters ?? nextStop?.distanceMeters ?? 0);
  const toiletDue = Date.now() - lastToiletAt > 75 * 60 * 1000 || (realWait || 0) > 15;
  const outsidePark = position && distanceMeters(position, { lat: 50.00025, lng: 19.4058 }) > 1800;

  useEffect(() => {
    if (!selectedId && nextStop) setSelectedId(nextStop.id);
  }, [nextStop, selectedId]);

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationStatus("unsupported");
      return;
    }
    setLocationStatus("loading");
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const next = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy };
        setPosition(next);
        setFocus(next);
        setLocationStatus("ready");
      },
      () => setLocationStatus("denied"),
      { enableHighAccuracy: true, maximumAge: 8000, timeout: 15000 },
    );
  }, []);

  const markDone = useCallback((id) => {
    if (!id) return;
    setCompletedIds((current) => current.includes(id) ? current : [...current, id]);
    setSelectedId(null);
    setFocus(null);
  }, []);

  const selectAttraction = useCallback((attraction) => {
    setMapMode("route");
    setSelectedId(attraction.id);
    setFocus(attraction);
  }, []);

  const showNearestToilet = useCallback(() => {
    if (!nearest.toilet) return;
    setMapMode("toilets");
    setSelectedId(nearest.toilet.id);
    setFocus(nearest.toilet);
  }, [nearest]);

  const confirmToilet = useCallback(() => {
    const now = Date.now();
    setLastToiletAt(now);
    window.localStorage.setItem(TOILET_KEY, String(now));
  }, []);

  const primaryRoute = route.filter((stop) => stop.familyTier === "primary");
  const secondaryRoute = route.filter((stop) => stop.familyTier === "secondary");
  const displayRoute = [...primaryRoute, ...secondaryRoute];

  const renderRouteRow = (stop, index) => {
    const queue = queueForAttraction(stop, queues);
    return (
      <button
        className={`tier-${stop.familyTier} ${stop.id === selectedStop?.id ? "selected" : ""}`}
        type="button"
        key={stop.id}
        onClick={() => selectAttraction(stop)}
      >
        <span className="route-number">{index + 1}</span>
        <span className="route-copy"><strong>{stop.name}</strong><small>{zoneName(stop.zone)} • {restrictionLabel(stop)}</small></span>
        <span className={`route-wait ${queue && !queue.isOpen ? "closed" : ""}`}>{queueLabel(queue)}</span>
        <CaretRight size={17} aria-hidden="true" />
      </button>
    );
  };

  return (
    <>
      <div className="app-scroll park-scroll">
        <header className="park-topbar">
          <div>
            <p className="eyebrow">ENERGYLANDIA • NA MIEJSCU</p>
            <h1>Wasza trasa</h1>
          </div>
          <span className="round-status" aria-label="Stały profil 120 do 129 centymetrów">120+</span>
        </header>

        <div className="family-profile-bar fixed">
          <UsersThree size={22} weight="duotone" aria-hidden="true" />
          <span><strong>Ja + Adam + 2 × 6 lat</strong><small>stały profil dzieci: {FAMILY_PROFILE.heightRangeLabel}</small></span>
        </div>

        <div className="ride-priority-legend" aria-label="Legenda priorytetu atrakcji">
          <span className="primary"><i /> <strong>Zielone</strong> próg 120 cm</span>
          <span className="secondary"><i /> <strong>Żółte</strong> 100–110 cm lub wg wieku</span>
        </div>

        {weatherSummary && (
          <div className={`park-weather ${weatherSummary.rainSoon ? "rain" : ""}`}>
            <CloudRain size={19} weight="duotone" aria-hidden="true" />
            <span>
              <strong>{weatherSummary.temperature == null ? "Pogoda na żywo" : `${weatherSummary.temperature}° teraz`}</strong>
              <small>{weatherSummary.rainSoon ? `ryzyko deszczu do ${weatherSummary.rainRisk}% — wodne atrakcje wcześniej` : `najbliższe godziny spokojne • deszcz ${weatherSummary.rainRisk}%`}</small>
            </span>
          </div>
        )}

        {nextStop ? (
          <section className={`next-stop-card tier-${nextStop.familyTier}`} aria-labelledby="next-stop-title">
            <div className="next-stop-kicker">
              <span><Sparkle size={15} weight="fill" /> {nextStop.familyTier === "primary" ? "ZIELONY PRIORYTET" : "ŻÓŁTA OPCJA"}</span>
              <em>{zoneName(nextStop.zone)}</em>
            </div>
            <div className="next-stop-heading">
              <div>
                <h2 id="next-stop-title">{nextStop.name}</h2>
                <p>{restrictionLabel(nextStop)} • {nextStop.reason || "dobry krok na rodzinnej trasie"}</p>
              </div>
              <span className={`queue-badge ${nextQueue && !nextQueue.isOpen ? "closed" : ""}`}>
                <Timer size={16} weight="bold" /> {queueLabel(nextQueue)}
              </span>
            </div>
            <div className="next-stop-facts">
              <span><Footprints size={18} weight="duotone" /> {nextDistance ? `~${walkingMinutes(nextDistance)} min` : "start trasy"}</span>
              <span><Compass size={18} weight="duotone" /> {intensityLabel(nextStop.intensity)}</span>
              {realWait > (nextQueue?.waitTime || 0) && <span><WarningCircle size={18} weight="duotone" /> realnie ~{realWait} min</span>}
            </div>
            <div className="next-stop-actions">
              <button className="button button-secondary" type="button" onClick={() => { setSelectedId(nextStop.id); setFocus(nextStop); }}>
                <MapPin size={20} weight="bold" /> Na mapie
              </button>
              <button className="button button-primary" type="button" onClick={() => markDone(nextStop.id)}>
                <Check size={20} weight="bold" /> Zrobione
              </button>
            </div>
          </section>
        ) : (
          <section className="route-finished">
            <CheckCircle size={34} weight="fill" aria-hidden="true" />
            <div><p className="eyebrow">PLAN ZREALIZOWANY</p><h2>Macie rodzinny komplet.</h2><p>Teraz wybierzcie powtórkę bez gonienia przez cały park.</p></div>
          </section>
        )}

        {toiletDue && nearest.toilet && (
          <div className="toilet-nudge">
            <Toilet size={23} weight="duotone" aria-hidden="true" />
            <span><strong>WC przed następną kolejką</strong><small>{nearest.toilet.name} • {nearest.distance ? `około ${walkingMinutes(nearest.distance)} min` : "po drodze"}</small></span>
            <button type="button" onClick={confirmToilet}>Byliśmy</button>
          </div>
        )}

        <section className="map-section" aria-labelledby="map-title">
          <div className="section-heading-row">
            <div><p className="eyebrow">GDZIE JESTEŚCIE</p><h2 id="map-title">Mapa parku</h2></div>
            <div className="map-toggle" aria-label="Warstwa mapy">
              <button type="button" className={mapMode === "route" ? "selected" : ""} onClick={() => setMapMode("route")}>Trasa</button>
              <button type="button" className={mapMode === "toilets" ? "selected" : ""} onClick={() => setMapMode("toilets")}>WC</button>
            </div>
          </div>
          <ParkMap
            attractions={displayRoute}
            toilets={TOILETS}
            position={position}
            selectedId={selectedId}
            focus={focus || selectedStop}
            showToilets={mapMode === "toilets"}
            onSelect={selectAttraction}
          />
          <div className="map-actions">
            <button type="button" onClick={locate} className={locationStatus === "ready" ? "located" : ""}>
              <Crosshair size={18} weight="bold" />
              {locationStatus === "loading" ? "Szukam…" : locationStatus === "ready" ? "Pozycja włączona" : "Znajdź nas"}
            </button>
            <button type="button" onClick={showNearestToilet} disabled={!nearest.toilet}>
              <Toilet size={18} weight="bold" /> Najbliższe WC
            </button>
          </div>
          {locationStatus === "denied" && <p className="map-message">Włącz dostęp do lokalizacji w przeglądarce albo korzystaj z trasy strefami.</p>}
          {outsidePark && <p className="map-message warning">GPS pokazuje pozycję poza parkiem — sprawdź dokładność telefonu.</p>}
        </section>

        <section className="route-section" aria-labelledby="route-title">
          <div className="section-heading-row">
            <div><p className="eyebrow">OD TYŁU DO WYJŚCIA</p><h2 id="route-title">Plan bez biegania</h2></div>
            <span className="route-progress">{completedIds.length}/{route.length + completedIds.length}</span>
          </div>
          <p className="route-intro">Najpierw zielone hity od 120 cm: Sweet Valley → Aqualantis → Formuła → Strefa Familijna. Żółte traktujcie jako zapas po drodze.</p>

          {primaryRoute.length > 0 && (
            <div className="route-group primary">
              <div className="route-group-heading"><span><i /> ZIELONE • GŁÓWNY PLAN</span><strong>{primaryRoute.length}</strong></div>
              <div className="route-list">{primaryRoute.map((stop, index) => renderRouteRow(stop, index))}</div>
            </div>
          )}

          {secondaryRoute.length > 0 && (
            <div className="route-group secondary">
              <div className="route-group-heading"><span><i /> ŻÓŁTE • JEŚLI MACIE CZAS</span><strong>{secondaryRoute.length}</strong></div>
              <div className="route-list">{secondaryRoute.map((stop, index) => renderRouteRow(stop, primaryRoute.length + index))}</div>
            </div>
          )}
        </section>

        <button className="park-source-summary" type="button" onClick={() => setSheet("sources")}>
          <Database size={20} weight="duotone" aria-hidden="true" />
          <span><strong>Dane oficjalne + mapa + kolejki</strong><small>{queueError || (queues ? `kolejki ${formatFreshness(queues.updatedAt)}` : "łączę źródła")}</small></span>
          <ArrowClockwise size={17} className={queueRefreshing ? "spin" : ""} aria-hidden="true" />
          <CaretRight size={18} aria-hidden="true" />
        </button>

        <footer className="park-footer">
          <Info size={15} aria-hidden="true" />
          <p>Plan jest spersonalizowaną podpowiedzią, nie regulaminem. Ograniczenia przy wejściu do atrakcji i polecenia obsługi zawsze mają pierwszeństwo.</p>
        </footer>
      </div>

      {sheet === "sources" && <ParkSourcesSheet onClose={() => setSheet(null)} />}
    </>
  );
}
