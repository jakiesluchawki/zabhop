import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowRight,
  CaretRight,
  CheckCircle,
  Clock,
  CloudLightning,
  CloudRain,
  Database,
  Info,
  ShieldWarning,
  Thermometer,
  Ticket,
  WarningCircle,
  Wind,
  X,
} from "@phosphor-icons/react";
import { RAIN_ALERT_STATE } from "./rainAlert.js";
import { formatFreshness, formatPolishDay } from "./weather.js";

const DIAL_ANGLES = Object.freeze({ sun: -48, cloud: 50, rain: 180 });
const DIAL_LABELS = Object.freeze({ sun: "słońce", cloud: "chmury", rain: "deszcz" });

function roundMetric(value, fallback = "—") {
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

function dialCondition(recommendation) {
  const metrics = recommendation?.metrics;
  if (!metrics) return "cloud";
  const maxProbability = Math.max(0, ...(recommendation.hours || []).map((hour) => hour.precipProbability || 0));
  if (metrics.maxThunder >= 25 || metrics.rainTotal >= 0.6 || metrics.maxRain >= 0.35 || maxProbability >= 70) return "rain";
  if ((metrics.averageCloudCover ?? 50) >= 55 || metrics.rainTotal >= 0.1 || maxProbability >= 35) return "cloud";
  return "sun";
}

function formatVisitStart(dateKey) {
  return dateKey ? formatPolishDay(dateKey, true) : "wybranego dnia";
}

function visitHeadline(visit) {
  if (!visit || visit.dayCount == null) return "Najpierw sprawdźmy pogodę.";
  if (visit.status === "avoid") return "Jeszcze nie kupuj dłuższego pobytu.";
  if (visit.dayCount === 3) return "3 dni mają sens.";
  if (visit.dayCount === 2) return "2 dni mają sens.";
  return "Zacznij od 1 dnia.";
}

export function WeatherDial({ condition = "cloud", confidence = null, loading = false, animationKey = "" }) {
  return (
    <figure className={`weather-start-dial ${loading ? "is-loading" : ""}`} aria-label={`Wskaźnik pogody: ${loading ? "analizuję" : DIAL_LABELS[condition]}`}>
      <div className="weather-start-dial-stage">
        <img
          className="weather-start-dial-base"
          src={`${import.meta.env.BASE_URL}assets/weather-dial-v3.jpg`}
          alt=""
          aria-hidden="true"
          width="1024"
          height="1024"
        />
        <img
          key={`${condition}-${animationKey}`}
          className={`weather-start-dial-pointer ${loading ? "is-searching" : "is-settling"}`}
          src={`${import.meta.env.BASE_URL}assets/weather-pointer-v3.png`}
          alt=""
          width="1024"
          height="1024"
          style={{ "--dial-target": `${DIAL_ANGLES[condition]}deg` }}
        />
      </div>
      {confidence && <figcaption><span />pewność {confidence}</figcaption>}
    </figure>
  );
}

function SheetFrame({ eyebrow, title, closeLabel, onClose, children }) {
  const sheetRef = useRef(null);
  const closeRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    previousFocusRef.current = document.activeElement;
    const sheet = sheetRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });

    const handleKeys = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab" || !sheet) return;
      const focusable = [...sheet.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        closeRef.current?.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeys);
    return () => {
      document.removeEventListener("keydown", handleKeys);
      document.body.style.overflow = previousOverflow;
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div className="weather-sheet-layer">
      <button className="weather-sheet-backdrop" type="button" tabIndex="-1" aria-label={closeLabel} onClick={onClose} />
      <section ref={sheetRef} className="weather-bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="weather-sheet-title">
        <div className="weather-sheet-handle" aria-hidden="true" />
        <header>
          <div><p className="eyebrow">{eyebrow}</p><h2 id="weather-sheet-title">{title}</h2></div>
          <button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label="Zamknij"><X size={22} weight="bold" /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

function SourceSheet({ weather, onClose }) {
  return (
    <SheetFrame eyebrow="TRANSPARENTNOŚĆ" title="Skąd bierzemy pogodę" closeLabel="Zamknij źródła" onClose={onClose}>
      <div className="weather-source-list">
        {(weather?.sources || []).map((source) => (
          <a className={`weather-source-row ${source.status}`} href={source.href || undefined} target="_blank" rel="noreferrer" key={source.name}>
            {source.status === "ok" ? <CheckCircle size={22} weight="fill" /> : <WarningCircle size={22} weight="fill" />}
            <span><strong>{source.name}</strong><small>{source.detail}</small></span>
            <span>{formatFreshness(source.updatedAt)}</span>
            <CaretRight size={18} aria-hidden="true" />
          </a>
        ))}
      </div>
      {weather?.icm?.imageUrl && (
        <a className="weather-icm-preview" href={weather.icm.pageUrl} target="_blank" rel="noreferrer">
          <img src={weather.icm.imageUrl} alt="Aktualny meteorogram ICM UM 4 km dla Zatora" loading="lazy" />
          <span>Otwórz pełny meteorogram ICM</span>
        </a>
      )}
      <p className="weather-sheet-note">ICM opisuje trend całego dnia. Ostrzeżenie „ruszajcie do auta” opieramy na świeżo sprawdzonym Antistorm z najbliższego dostępnego punktu — to sygnał orientacyjny, nie gwarancja pogody dokładnie nad parkiem.</p>
    </SheetFrame>
  );
}

function HourSheet({ recommendation, onClose }) {
  const hours = recommendation?.hours || [];
  const start = recommendation?.bestWindow?.start;
  const end = recommendation?.bestWindow?.end;
  return (
    <SheetFrame eyebrow="PARK 10:00–20:00" title="Plan godzinowy" closeLabel="Zamknij plan godzinowy" onClose={onClose}>
      <div className="weather-hour-list">
        {hours.map((hour) => {
          const selected = start != null && hour.hour >= start && hour.hour < end;
          const rainRisk = Math.max(hour.precipProbability || 0, (hour.precipitation || 0) * 24);
          return (
            <div className={selected ? "selected" : ""} key={hour.hour}>
              <strong>{hour.label}</strong>
              <span
                className="weather-rain-track"
                role="progressbar"
                aria-label="Ryzyko opadu"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={Math.round(Math.min(100, Math.max(0, rainRisk)))}
              ><span aria-hidden="true" style={{ width: `${Math.min(100, Math.max(0, rainRisk))}%` }} /></span>
              <span>{(hour.precipitation || 0).toFixed(1).replace(".", ",")} mm</span>
              <span>{roundMetric(hour.temperature)}°</span>
            </div>
          );
        })}
      </div>
      <p className="weather-sheet-note">Fioletowe wiersze tworzą najlepsze ciągłe okno wizyty. To plan dnia, nie alert na najbliższe pół godziny.</p>
    </SheetFrame>
  );
}

function VisitSheet({ assessment, onUseRecommendation, onClose }) {
  const visit = assessment?.visit;
  return (
    <SheetFrame eyebrow="ILE DNI?" title={visitHeadline(visit)} closeLabel="Zamknij ocenę pobytu" onClose={onClose}>
      <p className="weather-visit-summary">{visit?.summary || "Nie mamy jeszcze wystarczająco pełnych danych."}</p>
      <div className="weather-visit-days">
        {(assessment?.days || []).map((day) => (
          <div className={visit?.selectedIndices?.includes(day.index) ? "selected" : ""} key={day.dateKey || day.index}>
            <span>{day.dateKey ? formatPolishDay(day.dateKey, true) : `Dzień ${day.index + 1}`}</span>
            <strong>{day.recommendation?.score ?? "—"}<small>/100</small></strong>
            <em>{day.recommendation?.label || "BRAK DANYCH"}</em>
          </div>
        ))}
      </div>
      <ul className="weather-visit-reasons">
        {(visit?.reasons || []).map((reason) => <li key={reason}>{reason}</li>)}
        {(visit?.warnings || []).map((warning) => <li className="warning" key={warning}>{warning}</li>)}
      </ul>
      {visit?.dayCount && <button className="weather-sheet-primary" type="button" onClick={() => onUseRecommendation(visit)}>Użyj rekomendacji: {visit.dayCount} {visit.dayCount === 1 ? "dzień" : "dni"}<ArrowRight size={19} weight="bold" /></button>}
    </SheetFrame>
  );
}

function alertPresentation(alert) {
  if (!alert) return { tone: "unknown", title: "Łączę alert opadowy", detail: "Antistorm jest sprawdzany niezależnie od prognozy dnia." };
  if (alert.state === RAIN_ALERT_STATE.SHELTER_NOW) {
    return {
      tone: "danger",
      title: "Burza jest nad najbliższym punktem — schowajcie się teraz",
      detail: "Nie zaczynajcie teraz długiego marszu do samochodu. Zostańcie w bezpiecznym zadaszonym miejscu i stosujcie się do poleceń obsługi parku.",
    };
  }
  if (alert.state === RAIN_ALERT_STATE.RAINING) {
    return { tone: "danger", title: "Antistorm pokazuje opad w najbliższym punkcie", detail: "Jeśli opad jest już nad parkiem, zostańcie pod dachem. Do auta ruszcie dopiero, gdy przejście będzie bezpieczne." };
  }
  if (alert.state === RAIN_ALERT_STATE.LEAVE_NOW) {
    const hazard = alert.hazard === "storm" ? "Burza" : "Opad";
    return { tone: "danger", title: `${hazard} może być za ${alert.etaMinutes} min — ruszajcie do auta`, detail: `Z głębi parku liczymy ostrożnie około ${alert.carWalkMinutes || 30} min do samochodu.` };
  }
  if (alert.state === RAIN_ALERT_STATE.UNAVAILABLE) {
    return { tone: "unknown", title: alert.reason === "stale" ? "Nowcast jest nieaktualny" : "Brak świeżego nowcastu", detail: "Nie zakładamy, że jest spokojnie. Odświeżcie dane lub sprawdźcie radar bezpośrednio." };
  }
  if (Number.isFinite(alert.etaMinutes) && alert.etaMinutes <= 60) {
    return { tone: "watch", title: `Sygnał opadu za około ${alert.etaMinutes} min`, detail: `To jeszcze poza oknem marszu do auta, ale warto zostać bliżej wyjścia i sprawdzić ponownie za kilka minut.` };
  }
  return { tone: "clear", title: "Brak bliskiego sygnału opadu", detail: "Świeży Antistorm nie pokazuje teraz wiarygodnego opadu ani burzy w oknie potrzebnym na dojście do auta." };
}

export function RainSafetyCard({ assessment, status = "ready", onRefresh, compact = false }) {
  const alert = assessment?.rainAlert;
  const presentation = alertPresentation(alert);
  const antistorm = alert?.evidence?.find((item) => item.source === "antistorm");
  const checking = status === "loading" || status === "refreshing";
  return (
    <section className={`rain-safety-card ${presentation.tone} ${compact ? "compact" : ""}`} role={presentation.tone === "danger" ? "alert" : "status"} aria-live={presentation.tone === "danger" ? "assertive" : "polite"} aria-label="Alert opadowy Antistorm">
      <div className="rain-safety-icon">{presentation.tone === "danger" ? <ShieldWarning size={24} weight="fill" /> : presentation.tone === "watch" ? <CloudLightning size={24} weight="fill" /> : <CloudRain size={24} weight="duotone" />}</div>
      <div className="rain-safety-copy">
        <span>TERAZ • ANTISTORM</span>
        <strong>{checking && !assessment ? "Sprawdzam najbliższy opad…" : presentation.title}</strong>
        {!compact && <p>{presentation.detail}</p>}
        <small>{antistorm?.station || "najbliższy punkt"} • {antistorm?.freshness?.checkedAt ? `sprawdzone ${formatFreshness(antistorm.freshness.checkedAt)}` : "brak świeżego odczytu"} • bufor do auta 30 min</small>
      </div>
      {onRefresh && <button type="button" onClick={onRefresh} disabled={checking} aria-label="Odśwież alert opadowy"><ArrowClockwise className={checking ? "spin" : ""} size={19} weight="bold" /></button>}
    </section>
  );
}

export function WeatherStart({ weather, assessment, status, onRefresh, onContinue, onResume, damagedLink = false }) {
  const [sheet, setSheet] = useState(null);
  const preferredDayIndex = assessment?.visit?.selectedIndices?.[0]
    ?? assessment?.days?.find((day) => Number.isFinite(day.recommendation?.score))?.index
    ?? 0;
  const [selectedIndex, setSelectedIndex] = useState(preferredDayIndex);
  const dayChosenByUser = useRef(false);

  useEffect(() => {
    const selectedStillExists = assessment?.days?.some((day) => day.index === selectedIndex && day.dateKey);
    if (!selectedStillExists || !dayChosenByUser.current) setSelectedIndex(preferredDayIndex);
  }, [assessment, preferredDayIndex, selectedIndex]);

  const selectedDay = assessment?.days?.find((day) => day.index === selectedIndex) ?? assessment?.days?.[preferredDayIndex] ?? null;
  const recommendation = selectedDay?.recommendation ?? null;
  const visit = assessment?.visit ?? null;
  const loading = !assessment && (status === "loading" || status === "refreshing");
  const refreshing = status === "refreshing";
  const tone = recommendation?.score == null ? "neutral" : recommendation.score >= 70 ? "go" : recommendation.score >= 45 ? "careful" : "stop";
  const scoreText = recommendation?.score ?? "—";
  const metrics = recommendation?.metrics;
  const bestWindow = recommendation?.bestWindow
    ? `${String(recommendation.bestWindow.start).padStart(2, "0")}:00–${String(recommendation.bestWindow.end).padStart(2, "0")}:00`
    : "brak";
  const recommendedStart = visit?.selectedDateKeys?.[0] ?? selectedDay?.dateKey ?? null;
  const recommendedCount = visit?.dayCount ?? 1;
  const dayTabs = useMemo(() => [
    { label: "Dzisiaj", day: assessment?.days?.[0] },
    { label: "Jutro", day: assessment?.days?.[1] },
    { label: "Pojutrze", day: assessment?.days?.[2] },
  ], [assessment]);

  const continueWith = (selection = visit) => {
    const dayCount = selection?.dayCount ?? recommendedCount;
    const startDate = selection?.selectedDateKeys?.[0] ?? recommendedStart;
    setSheet(null);
    onContinue({ dayCount, startDate });
  };

  return (
    <main className={`weather-start screen-app tone-${tone}`}>
      <div className="weather-start-scroll">
        <header className="weather-start-topbar">
          <div className="weather-start-brand">
            <img src={`${import.meta.env.BASE_URL}icon-192-v3.png`} alt="" width="45" height="45" />
            <div><p>PogodaPark</p><span>ENERGYLANDIA • ZATOR</span></div>
          </div>
          <button className={`weather-live-pill ${refreshing ? "busy" : ""}`} type="button" onClick={onRefresh} disabled={refreshing}>
            <span />{refreshing ? "ODŚWIEŻAM" : "NA ŻYWO"}
          </button>
        </header>

        {damagedLink && <div className="weather-inline-warning" role="alert"><WarningCircle size={21} weight="fill" /><span>Ten link do planu jest uszkodzony albo pochodzi ze starszej wersji. Możesz ułożyć nową trasę.</span></div>}

        <nav className="weather-day-switch" aria-label="Dzień prognozy">
          {dayTabs.map(({ label, day }, index) => (
            <button key={label} type="button" disabled={!day?.dateKey} className={selectedIndex === index ? "selected" : ""} aria-pressed={selectedIndex === index} onClick={() => { dayChosenByUser.current = true; setSelectedIndex(index); }}>{label}</button>
          ))}
        </nav>

        <section className="weather-decision" aria-live="polite">
          <div className="weather-decision-heading">
            <div>
              <p className="eyebrow">{selectedDay?.dateKey ? `${formatPolishDay(selectedDay.dateKey).toUpperCase()} • 10:00–20:00` : "ZATOR • POGODA NA ŻYWO"}</p>
              <h1>{loading ? "Czytam prognozy…" : recommendation?.headline || "Brak uczciwego werdyktu."}</h1>
            </div>
            <div className="weather-score" aria-label={`Ocena ${scoreText} na 100`}><strong>{scoreText}</strong><span>/100</span></div>
          </div>
          <p className="weather-decision-lead">{recommendation ? <>Najlepsze okno <strong>{bestWindow}</strong>. {recommendation.reasons?.[0]}.</> : "Łączę ICM, DWD, MET Norway, Open-Meteo i Antistorm."}</p>

          <WeatherDial condition={dialCondition(recommendation)} confidence={recommendation?.confidence} loading={loading || refreshing} animationKey={`${selectedDay?.dateKey || "loading"}-${weather?.updatedAt || status}`} />

          {metrics && (
            <div className="weather-metric-strip">
              <div><CloudRain size={20} weight="duotone" /><strong>{metrics.rainTotal.toFixed(1).replace(".", ",")} mm</strong><span>opad w oknie</span></div>
              <div><Wind size={20} weight="duotone" /><strong>{roundMetric(metrics.maxGust)} km/h</strong><span>porywy</span></div>
              <div><Thermometer size={20} weight="duotone" /><strong>{roundMetric(metrics.minTemp)}–{roundMetric(metrics.maxTemp)}°</strong><span>temperatura</span></div>
            </div>
          )}
        </section>

        {visit && (
          <button className={`weather-trip-summary trip-${visit.status}`} type="button" onClick={() => setSheet("visit")}>
            <Ticket size={22} weight="duotone" aria-hidden="true" />
            <span><small>1, 2 CZY 3 DNI?</small><strong>{visitHeadline(visit)}</strong><em>{assessment.days.filter((day) => Number.isFinite(day.recommendation?.score)).map((day) => day.recommendation.score).join(" + ")} pkt • start {formatVisitStart(recommendedStart)}</em></span>
            <CaretRight size={18} aria-hidden="true" />
          </button>
        )}

        <RainSafetyCard assessment={assessment} status={status} onRefresh={onRefresh} />

        {(status === "error" || status === "stale") && <div className="weather-inline-warning" role="status"><WarningCircle size={21} weight="fill" /><span>{status === "stale" ? "Pokazujemy ostatnią udaną prognozę. Odśwież przed decyzją o zakupie." : "Nie udało się pobrać prognozy. Trasę nadal możesz ułożyć, ale liczby dni nie wybieraj na ślepo."}</span></div>}

        <div className="weather-action-row">
          <button type="button" onClick={() => setSheet("hours")} disabled={!recommendation?.hours?.length}><Clock size={20} weight="bold" /> Godziny</button>
          <button type="button" onClick={onRefresh} disabled={refreshing}><ArrowClockwise className={refreshing ? "spin" : ""} size={20} weight="bold" /> {refreshing ? "Sprawdzam" : "Odśwież werdykt"}</button>
        </div>

        <button className="weather-continue" type="button" onClick={() => continueWith()}>
          <span><strong>Ułóż trasę</strong><small>{recommendedCount} {recommendedCount === 1 ? "dzień" : "dni"} od {formatVisitStart(recommendedStart)} — zmienisz to w ankiecie</small></span>
          <ArrowRight size={22} weight="bold" />
        </button>
        {onResume && <button className="weather-resume" type="button" onClick={onResume}>Wróć do zapisanego planu</button>}

        <button className="weather-source-summary" type="button" onClick={() => setSheet("sources")} disabled={!weather?.sources?.length}>
          <Database size={19} weight="duotone" aria-hidden="true" />
          <span><strong>5 źródeł pogody</strong><small>ICM • Antistorm • DWD + 2 modele</small></span>
          <span>{formatFreshness(weather?.updatedAt)}</span>
          <CaretRight size={18} aria-hidden="true" />
        </button>

        <footer className="weather-start-footer"><Info size={15} aria-hidden="true" /><p>Nieoficjalna rekomendacja pogodowa. Zwykły deszcz nie zamyka parku; burze i silny wiatr mogą czasowo wyłączyć atrakcje.</p></footer>
      </div>

      {sheet === "sources" && <SourceSheet weather={weather} onClose={() => setSheet(null)} />}
      {sheet === "hours" && <HourSheet recommendation={recommendation} onClose={() => setSheet(null)} />}
      {sheet === "visit" && <VisitSheet assessment={assessment} onUseRecommendation={continueWith} onClose={() => setSheet(null)} />}
    </main>
  );
}
