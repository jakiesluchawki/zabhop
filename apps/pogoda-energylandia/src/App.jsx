import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  CaretRight,
  CheckCircle,
  Clock,
  CloudRain,
  Database,
  Info,
  Minus,
  Plus,
  Thermometer,
  Ticket,
  WarningCircle,
  Wind,
  X,
} from "@phosphor-icons/react";
import { chooseRecommendation } from "./decision.js";
import {
  formatFreshness,
  formatPolishDay,
  loadAntistormNowcast,
  loadWeather,
  nextLocalHour,
  PARK_HOURS,
} from "./weather.js";
import {
  compareVisitLengths,
  getDialCondition,
  TICKET_SOURCE_URL,
  ticketPricesFor,
} from "./trip.js";
import { AppNav } from "./AppNav.jsx";
import { ParkView } from "./ParkView.jsx";

function roundMetric(value, fallback = "—") {
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

function formatMoney(value) {
  return new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

const DIAL_ANGLES = { sun: -48, cloud: 50, rain: 180 };
const DIAL_LABELS = { sun: "słońce", cloud: "chmury", rain: "deszcz" };

function WeatherDial({ condition = "cloud", confidence = null, loading = false, animationKey = "" }) {
  return (
    <figure className={`weather-hero ${loading ? "weather-hero-loading" : ""}`} aria-label={`Wskaźnik pogody: ${loading ? "analizuję" : DIAL_LABELS[condition]}`}>
      <div className="dial-stage">
        <img
          className="dial-base"
          src={`${import.meta.env.BASE_URL}assets/weather-dial-v3.jpg`}
          alt="Filcowa tarcza ze słońcem, chmurą, deszczem i wagonikiem jadącym po torze kolejki"
        />
        <img
          key={`${condition}-${animationKey}`}
          className={`dial-pointer ${loading ? "is-searching" : "is-settling"}`}
          src={`${import.meta.env.BASE_URL}assets/weather-pointer-v3.png`}
          alt=""
          style={{ "--dial-target": `${DIAL_ANGLES[condition]}deg` }}
        />
      </div>
      {confidence && <figcaption><span />pewność {confidence}</figcaption>}
    </figure>
  );
}

function StatusIcon({ status }) {
  return status === "ok"
    ? <CheckCircle aria-hidden="true" size={22} weight="fill" />
    : <WarningCircle aria-hidden="true" size={22} weight="fill" />;
}

function SourceSheet({ weather, onClose }) {
  return (
    <div className="sheet-layer">
      <button className="sheet-backdrop" aria-label="Zamknij źródła" type="button" onClick={onClose} />
      <section className="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="sources-title">
        <div className="sheet-handle" aria-hidden="true" />
        <header className="sheet-header">
          <div>
            <p className="eyebrow">TRANSPARENTNOŚĆ</p>
            <h2 id="sources-title">Skąd bierzemy pogodę</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Zamknij">
            <X size={22} weight="bold" />
          </button>
        </header>

        <div className="source-list">
          {weather.sources.map((source) => (
            <a className={`source-row ${source.status}`} href={source.href || undefined} target="_blank" rel="noreferrer" key={source.name}>
              <StatusIcon status={source.status} />
              <span>
                <strong>{source.name}</strong>
                <small>{source.detail}</small>
              </span>
              <span className="source-time">{formatFreshness(source.updatedAt)}</span>
              <CaretRight aria-hidden="true" size={18} />
            </a>
          ))}
        </div>

        {weather.icm?.imageUrl && (
          <a className="icm-preview" href={weather.icm.pageUrl} target="_blank" rel="noreferrer">
            <img src={weather.icm.imageUrl} alt="Aktualny meteorogram ICM UM 4 km dla Zatora" loading="lazy" />
            <span>Otwórz pełny meteorogram ICM</span>
          </a>
        )}

        <p className="sheet-note">
          ICM pokazuje trend na cały dzień i jego przebieg może mieć kilka godzin. Alert „ruszajcie do auta” opieramy na świeżo sprawdzonym Antistorm z najbliższego punktu — Wadowic, około 15 km od Zatora. To sygnał orientacyjny, nie gwarancja pogody nad parkiem.
        </p>
      </section>
    </div>
  );
}

function HourSheet({ hours, recommendation, onClose }) {
  const start = recommendation.bestWindow?.start;
  const end = recommendation.bestWindow?.end;
  return (
    <div className="sheet-layer">
      <button className="sheet-backdrop" aria-label="Zamknij plan godzinowy" type="button" onClick={onClose} />
      <section className="bottom-sheet hour-sheet" role="dialog" aria-modal="true" aria-labelledby="hours-title">
        <div className="sheet-handle" aria-hidden="true" />
        <header className="sheet-header">
          <div>
            <p className="eyebrow">PARK 10:00–20:00</p>
            <h2 id="hours-title">Plan godzinowy</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Zamknij">
            <X size={22} weight="bold" />
          </button>
        </header>
        <div className="hour-list">
          {hours.map((hour) => {
            const selected = start != null && hour.hour >= start && hour.hour < end;
            const rainRisk = Math.max(hour.precipProbability || 0, (hour.precipitation || 0) * 24);
            return (
              <div className={`hour-row ${selected ? "selected" : ""}`} key={hour.hour}>
                <strong>{hour.label}</strong>
                <span className="rain-track" aria-label={`Ryzyko opadu ${Math.round(rainRisk)} procent`}>
                  <span style={{ width: `${Math.min(100, rainRisk)}%` }} />
                </span>
                <span>{(hour.precipitation || 0).toFixed(1).replace(".", ",")} mm</span>
                <span>{roundMetric(hour.temperature)}°</span>
              </div>
            );
          })}
        </div>
        <p className="sheet-note">Fioletowe wiersze tworzą najlepsze ciągłe okno pięciogodzinnej wizyty.</p>
      </section>
    </div>
  );
}

function PartyCounter({ label, detail, value, canDecrease, onDecrease, onIncrease }) {
  return (
    <div className="party-row">
      <span><strong>{label}</strong><small>{detail}</small></span>
      <div className="stepper" aria-label={`${label}: ${value}`}>
        <button type="button" onClick={onDecrease} disabled={!canDecrease} aria-label={`Odejmij: ${label}`}>
          <Minus size={17} weight="bold" />
        </button>
        <strong>{value}</strong>
        <button type="button" onClick={onIncrease} aria-label={`Dodaj: ${label}`}>
          <Plus size={17} weight="bold" />
        </button>
      </div>
    </div>
  );
}

function TripSheet({ weather, recommendations, advice, prices, party, onPartyChange, onClose }) {
  const costs = advice.costs;
  const canDecreaseStandard = party.standard > 0 && costs.people > 1;
  const canDecreaseDiscounted = party.discounted > 0 && costs.people > 1;
  return (
    <div className="sheet-layer">
      <button className="sheet-backdrop" aria-label="Zamknij porównanie dni" type="button" onClick={onClose} />
      <section className="bottom-sheet trip-sheet" role="dialog" aria-modal="true" aria-labelledby="trip-title">
        <div className="sheet-handle" aria-hidden="true" />
        <header className="sheet-header">
          <div>
            <p className="eyebrow">POGODA + REALNY KOSZT</p>
            <h2 id="trip-title">Jeden czy dwa dni?</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Zamknij">
            <X size={22} weight="bold" />
          </button>
        </header>

        <div className={`trip-verdict trip-${advice.mode}`}>
          <Ticket size={24} weight="duotone" aria-hidden="true" />
          <span><strong>{advice.headline}</strong><small>{advice.detail}</small></span>
        </div>

        <div className="trip-day-grid" aria-label="Oceny pogody na dwa kolejne dni">
          <div>
            <span>{formatPolishDay(weather.tomorrow, true)}</span>
            <strong>{recommendations.dayOne.score ?? "—"}<small>/100</small></strong>
            <em>{recommendations.dayOne.headline}</em>
          </div>
          <div>
            <span>{formatPolishDay(weather.dayAfterTomorrow, true)}</span>
            <strong>{recommendations.dayTwo.score ?? "—"}<small>/100</small></strong>
            <em>{recommendations.dayTwo.headline}</em>
          </div>
        </div>

        <div className="party-box">
          <p className="eyebrow">DLA KOGO LICZYMY</p>
          <PartyCounter
            label="Normalne"
            detail="od 140 cm"
            value={party.standard}
            canDecrease={canDecreaseStandard}
            onDecrease={() => onPartyChange("standard", -1)}
            onIncrease={() => onPartyChange("standard", 1)}
          />
          <PartyCounter
            label="Ulgowe"
            detail="do 140 cm / 65+"
            value={party.discounted}
            canDecrease={canDecreaseDiscounted}
            onDecrease={() => onPartyChange("discounted", -1)}
            onIncrease={() => onPartyChange("discounted", 1)}
          />
        </div>

        <div className="ticket-comparison">
          <div>
            <span>1 dzień</span>
            <strong>{formatMoney(costs.oneDay)} zł</strong>
            <small>łącznie</small>
          </div>
          <div className={advice.mode === "two" ? "recommended" : ""}>
            <span>2 dni</span>
            <strong>{formatMoney(costs.twoDay)} zł</strong>
            <small>{formatMoney(costs.twoDayPerDay)} zł / dzień</small>
          </div>
        </div>

        <p className="saving-line">
          <strong>{formatMoney(costs.savings)} zł mniej</strong> niż dwa osobne bilety jednodniowe. Drugi dzień wymaga dopłaty {formatMoney(costs.secondDayExtra)} zł.
        </p>

        <a className="ticket-source" href={TICKET_SOURCE_URL} target="_blank" rel="noreferrer">
          <span><strong>Oficjalny cennik e-biletów</strong><small>{prices.seasonLabel} • bilety 2-dniowe są na kolejne dni</small></span>
          <CaretRight size={18} aria-hidden="true" />
        </a>
        <p className="sheet-note">Kalkulacja nie dolicza noclegu, jedzenia ani parkingu. Jeśli drugi dzień ma wynik poniżej 50/100, niewielka oszczędność na bilecie nie przesądza rekomendacji.</p>
      </section>
    </div>
  );
}

function LoadingView() {
  return (
    <section className="loading-view" aria-live="polite">
      <WeatherDial loading animationKey="loading" />
      <p className="eyebrow">ZATOR • POGODA NA ŻYWO</p>
      <h1>Czytam prognozy…</h1>
      <p>Łączę ICM, DWD, MET Norway, Open-Meteo i Antistorm.</p>
      <span className="loading-line" />
    </section>
  );
}

export function App() {
  const [mode, setMode] = useState(() => window.location.hash.toLowerCase() === "#park" ? "park" : "weather");
  const [weather, setWeather] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nowcastRefreshing, setNowcastRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState(null);
  const [party, setParty] = useState({ standard: 1, discounted: 0 });

  const refresh = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      const next = await loadWeather();
      setWeather(next);
      setSelectedDay((current) => current || next.tomorrow);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udało się pobrać prognozy");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const refreshNowcast = useCallback(async () => {
    setNowcastRefreshing(true);
    try {
      const antistorm = await loadAntistormNowcast();
      setWeather((current) => {
        if (!current) return current;
        return {
          ...current,
          antistorm,
          sources: current.sources.map((source) => source.name === "Antistorm"
            ? {
              ...source,
              status: "ok",
              detail: `Nowcast co 15 min • ${antistorm.m} (najbliższy punkt)`,
              updatedAt: antistorm.updatedAt,
            }
            : source),
        };
      });
    } catch {
      // Zachowujemy poprzedni odczyt razem z jego czasem. Logika alertu
      // oznaczy go jako nieaktualny zamiast fałszywie pokazać „spokojnie”.
    } finally {
      setNowcastRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = window.setInterval(() => refresh(true), 15 * 60 * 1000);
    const onVisibility = () => document.visibilityState === "visible" && refresh(true);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    const interval = window.setInterval(refreshNowcast, 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [refreshNowcast]);

  useEffect(() => {
    const onHashChange = () => setMode(window.location.hash.toLowerCase() === "#park" ? "park" : "weather");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const changeMode = useCallback((nextMode) => {
    const nextUrl = nextMode === "park"
      ? `${window.location.pathname}${window.location.search}#park`
      : `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", nextUrl);
    setMode(nextMode);
  }, []);

  const hours = weather && selectedDay ? (weather.days[selectedDay] || []) : [];
  const recommendation = useMemo(() => {
    if (!weather || !selectedDay || !hours.length) return null;
    return chooseRecommendation(hours, {
      parkOpen: PARK_HOURS.open,
      parkClose: PARK_HOURS.close,
      visitHours: 5,
      icmAvailable: Boolean(weather.icm),
      numericSourceCount: weather.numericSourceCount,
      antistorm: weather.antistorm,
      applyAntistorm: selectedDay === weather.today,
      earliestStart: selectedDay === weather.today ? nextLocalHour() : PARK_HOURS.open,
    });
  }, [weather, selectedDay, hours]);

  const tripRecommendations = useMemo(() => {
    if (!weather) return null;
    const options = {
      parkOpen: PARK_HOURS.open,
      parkClose: PARK_HOURS.close,
      visitHours: 5,
      icmAvailable: Boolean(weather.icm),
      numericSourceCount: weather.numericSourceCount,
      applyAntistorm: false,
    };
    const dayOneHours = weather.days[weather.tomorrow] || [];
    const dayTwoHours = weather.days[weather.dayAfterTomorrow] || [];
    if (!dayOneHours.length || !dayTwoHours.length) return null;
    return {
      dayOne: chooseRecommendation(dayOneHours, options),
      dayTwo: chooseRecommendation(dayTwoHours, options),
    };
  }, [weather]);

  const prices = weather ? ticketPricesFor(weather.tomorrow) : null;
  const tripAdvice = useMemo(() => {
    if (!tripRecommendations || !prices) return null;
    return compareVisitLengths(
      tripRecommendations.dayOne,
      tripRecommendations.dayTwo,
      prices,
      party,
    );
  }, [tripRecommendations, prices, party]);

  const updateParty = useCallback((type, delta) => {
    setParty((current) => {
      const next = { ...current, [type]: Math.max(0, Math.min(10, current[type] + delta)) };
      return next.standard + next.discounted >= 1 ? next : current;
    });
  }, []);

  const dialCondition = getDialCondition(recommendation);

  if (mode === "park") {
    return (
      <main className="mobile-prototype">
        <ParkView weather={weather} onRefreshNowcast={refreshNowcast} nowcastRefreshing={nowcastRefreshing} />
        <AppNav active="park" onChange={changeMode} />
      </main>
    );
  }

  if (loading && !weather) {
    return (
      <main className="mobile-prototype">
        <LoadingView />
        <AppNav active="weather" onChange={changeMode} />
      </main>
    );
  }

  if ((!weather || !recommendation) && error) {
    return (
      <main className="mobile-prototype">
        <section className="error-view">
          <WarningCircle size={42} weight="fill" aria-hidden="true" />
          <p className="eyebrow">CHWILOWA PRZERWA</p>
          <h1>Nie mam jeszcze werdyktu.</h1>
          <p>{error}</p>
          <button className="button button-primary" type="button" onClick={() => refresh()}>Spróbuj ponownie</button>
        </section>
        <AppNav active="weather" onChange={changeMode} />
      </main>
    );
  }

  if (!weather || !recommendation) return null;

  const tone = recommendation.score == null
    ? "neutral"
    : recommendation.score >= 70 ? "go" : recommendation.score >= 45 ? "careful" : "stop";
  const metrics = recommendation.metrics;
  const scoreText = recommendation.score == null ? "—" : recommendation.score;
  const bestWindow = recommendation.bestWindow
    ? `${String(recommendation.bestWindow.start).padStart(2, "0")}:00–${String(recommendation.bestWindow.end).padStart(2, "0")}:00`
    : "brak";

  return (
    <main className={`mobile-prototype tone-${tone}`}>
      <div className="app-scroll">
        <header className="topbar">
          <div className="brand-lockup">
            <img src={`${import.meta.env.BASE_URL}icon-192-v3.png`} alt="" className="brand-icon" />
            <div>
              <p className="brand-name">PogodaPark</p>
              <p className="brand-subtitle">ENERGYLANDIA • ZATOR</p>
            </div>
          </div>
          <div className={`live-pill ${refreshing ? "busy" : ""}`}>
            <span />
            {refreshing ? "ODŚWIEŻAM" : "NA ŻYWO"}
          </div>
        </header>

        <nav className="day-switch" aria-label="Dzień prognozy">
          <button type="button" className={selectedDay === weather.today ? "selected" : ""} onClick={() => setSelectedDay(weather.today)}>
            Dzisiaj
          </button>
          <button type="button" className={selectedDay === weather.tomorrow ? "selected" : ""} onClick={() => setSelectedDay(weather.tomorrow)}>
            Jutro
          </button>
        </nav>

        <section className="decision-section" aria-live="polite">
          <div className="decision-heading">
            <div>
              <p className="eyebrow">{formatPolishDay(selectedDay).toUpperCase()} • 10:00–20:00</p>
              <h1>{recommendation.headline}</h1>
            </div>
            <div className="score" aria-label={`Ocena ${scoreText} na 100`}>
              <strong>{scoreText}</strong><span>/100</span>
            </div>
          </div>
          <p className="decision-lead">
            Najlepsze okno <strong>{bestWindow}</strong>. {recommendation.reasons[0]}.
          </p>

          <WeatherDial
            condition={dialCondition}
            confidence={recommendation.confidence}
            animationKey={`${selectedDay}-${weather.updatedAt}`}
          />

          {metrics && (
            <div className="metric-strip">
              <div><CloudRain size={20} weight="duotone" /><strong>{metrics.rainTotal.toFixed(1).replace(".", ",")} mm</strong><span>opad w oknie</span></div>
              <div><Wind size={20} weight="duotone" /><strong>{roundMetric(metrics.maxGust)} km/h</strong><span>porywy</span></div>
              <div><Thermometer size={20} weight="duotone" /><strong>{roundMetric(metrics.minTemp)}–{roundMetric(metrics.maxTemp)}°</strong><span>temperatura</span></div>
            </div>
          )}
        </section>

        {tripAdvice && tripRecommendations && (
          <button className={`trip-summary trip-${tripAdvice.mode}`} type="button" onClick={() => setSheet("trip")}>
            <Ticket size={22} weight="duotone" aria-hidden="true" />
            <span>
              <small>1 CZY 2 DNI?</small>
              <strong>{tripAdvice.headline}</strong>
              <em>
                {tripRecommendations.dayOne.score ?? "—"} + {tripRecommendations.dayTwo.score ?? "—"} pkt
                {tripAdvice.costs?.savings ? ` • ${formatMoney(tripAdvice.costs.savings)} zł oszczędności` : ""}
              </em>
            </span>
            <CaretRight size={18} aria-hidden="true" />
          </button>
        )}

        <div className="action-row">
          <button className="button button-secondary" type="button" onClick={() => setSheet("hours")}>
            <Clock size={20} weight="bold" /> Plan
          </button>
          <button className="button button-primary" type="button" onClick={() => refresh(true)} disabled={refreshing}>
            <ArrowClockwise size={20} weight="bold" className={refreshing ? "spin" : ""} />
            {refreshing ? "Sprawdzam" : "Odśwież werdykt"}
          </button>
        </div>

        <button className="source-summary" type="button" onClick={() => setSheet("sources")}>
          <Database size={19} weight="duotone" aria-hidden="true" />
          <span><strong>5 źródeł pogody</strong><small>ICM • Antistorm • DWD + 2 modele</small></span>
          <span className="freshness">{formatFreshness(weather.updatedAt)}</span>
          <CaretRight size={18} aria-hidden="true" />
        </button>

        <footer>
          <Info size={15} aria-hidden="true" />
          <p>Nieoficjalna rekomendacja pogodowa. Zwykły deszcz nie zamyka parku; burze i silny wiatr mogą czasowo wyłączyć atrakcje.</p>
        </footer>
      </div>

      <AppNav active="weather" onChange={changeMode} />

      {sheet === "sources" && <SourceSheet weather={weather} onClose={() => setSheet(null)} />}
      {sheet === "hours" && <HourSheet hours={hours} recommendation={recommendation} onClose={() => setSheet(null)} />}
      {sheet === "trip" && tripAdvice && tripRecommendations && prices && (
        <TripSheet
          weather={weather}
          recommendations={tripRecommendations}
          advice={tripAdvice}
          prices={prices}
          party={party}
          onPartyChange={updateParty}
          onClose={() => setSheet(null)}
        />
      )}
    </main>
  );
}
