import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AppleLogo,
  ArrowLeft,
  ArrowClockwise,
  ArrowRight,
  ArrowsSplit,
  CalendarBlank,
  CaretRight,
  CheckCircle,
  Clock,
  CloudRain,
  Copy,
  Crosshair,
  EnvelopeSimple,
  Footprints,
  ForkKnife,
  GoogleLogo,
  MapPin,
  MapTrifold,
  Minus,
  PencilSimple,
  Plus,
  Printer,
  Ruler,
  ShareNetwork,
  Sparkle,
  Toilet,
  UsersThree,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { ALL_ATTRACTIONS_BY_ID, RESTAURANTS, TOILETS, VERIFIED_AT } from "./extendedData.js";
import { detailsForAttraction } from "./details.js";
import { createWalkingMapLinks } from "./mapNavigation.js";
import {
  attractionLabel,
  buildUniversalPlan,
  formatPlanTime,
  isGuardian,
  timeToMinutes,
  zoneLabel,
} from "./planner.js";
import { PlannerMap } from "./PlannerMap.jsx";
import { loadQueueTimes, queueForAttraction } from "./queues.js";
import { overlayShowsOnPlan } from "./showPlanner.js";
import {
  createShortPlanLink,
  createShortPlanUrl,
  createEmailDraftUrl,
  createPlanUrl,
  hasShortPlanHash,
  loadShortPlan,
  planFromHash,
  sanitizeSharedPlan,
  shortPlanTokenFromHash,
} from "./share.js";
import {
  ADULT_AGE_RANGE_OPTIONS,
  approximateWalkingMinutes,
  ageRangeFor,
  ageRangeLabel,
  CHILD_AGE_RANGE_OPTIONS,
  countPlanAttractions,
  distanceMeters,
  formatDistance,
  HEIGHT_RANGE_OPTIONS,
  heightRangeFor,
  heightRangeLabel,
  normalizeDraftProfile,
  queueFreshness,
} from "./appUtils.js";
import {
  geolocationFailureStatus,
  positionFromCoordinates,
  QUICK_LOCATION_OPTIONS,
  TRACKING_LOCATION_OPTIONS,
} from "./location.js";
import { loadShowSchedule, OFFICIAL_SHOW_INDEX, showDateAvailability, showScheduleFreshness } from "./shows.js";
import { loadAntistormNowcast, loadWeather, formatPolishDay } from "./weather.js";
import { assessThreeDayWeather } from "./weatherPlan.js";
import { RainSafetyCard, WeatherStart } from "./WeatherStart.jsx";
import { EntryStart } from "./EntryStart.jsx";

const DRAFT_KEY = "energylandia-planner-v1:draft";
const PLAN_KEY = "energylandia-planner-v1:plan";
const COMPLETED_KEY = "energylandia-planner-v1:completed";

const STEP_LABELS = ["CZAS", "SKŁAD", "WZROST", "APETYT", "PODZIAŁ", "OBIAD", "PODSUMOWANIE"];
const STEP_ILLUSTRATIONS = [
  { file: "01-czas.jpg", alt: "Trzy filcowe bilety połączone trasą kolejki między wschodem słońca i wieczorem" },
  { file: "02-sklad.jpg", alt: "Filcowa grupa dorosłych i dzieci jadąca razem parkową kolejką" },
  { file: "03-wzrost.jpg", alt: "Filcowe postacie przy miarce wzrostu przed wejściem na atrakcję" },
  { file: "04-apetyt.jpg", alt: "Trzy filcowe ścieżki prowadzące do spokojnych, rodzinnych i mocnych atrakcji" },
  { file: "05-podzial.jpg", alt: "Dwie bezpieczne filcowe trasy, na każdej dorosły z dzieckiem, łączące się w miejscu spotkania" },
  { file: "06-obiad.jpg", alt: "Filcowy stół piknikowy z posiłkiem ustawiony przy trasie przez park" },
  { file: "07-podsumowanie.jpg", alt: "Rozwinięta filcowa mapa kompletnego dnia z punktami trasy, obiadem i metą" },
];

const DEFAULT_PROFILE = Object.freeze({
  dayCount: 1,
  // A direct „Ułóż plan” path needs a real calendar day as well: otherwise
  // the optional official show timetable cannot match the generated day.
  visitStartDate: warsawDateKey(),
  arrivalTime: "10:00",
  departureTime: "20:00",
  pace: "normal",
  splitPolicy: "worthwhile",
  members: [
    { id: "adult-1", role: "adult", name: "Dorosły 1", age: 18, height: 170 },
    { id: "adult-2", role: "adult", name: "Dorosły 2", age: 18, height: 170 },
    { id: "child-1", role: "child", name: "Dziecko 1", age: 6, height: 120 },
    { id: "child-2", role: "child", name: "Dziecko 2", age: 6, height: 120 },
  ],
  preferences: {
    intensity: "mixed",
    interests: ["coasters", "family"],
    wet: "ok",
    maxQueue: 30,
  },
  entertainment: { includeShows: false },
  meal: { mode: "fast", time: "13:15" },
});

function readStored(key, fallback = null) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The app remains usable when private browsing blocks persistence.
  }
}

function defaultMember(role, index) {
  return role === "adult"
    ? { id: `adult-${index + 1}`, role, name: `Dorosły ${index + 1}`, age: 18, height: 170 }
    : { id: `child-${index + 1}`, role, name: `Dziecko ${index + 1}`, age: 6, height: 120 };
}

function countByRole(members, role) {
  return members.filter((member) => member.role === role).length;
}

function resizeMembers(members, role, requestedCount) {
  const count = Math.max(role === "adult" ? 1 : 0, Math.min(role === "adult" ? 6 : 8, requestedCount));
  const current = members.filter((member) => member.role === role);
  const resized = Array.from({ length: count }, (_, index) => current[index] ?? defaultMember(role, index));
  const other = members.filter((member) => member.role !== role);
  return role === "adult" ? [...resized, ...other] : [...other, ...resized];
}

function memberLabel(member) {
  return member?.name?.trim() || (member?.role === "adult" ? "Dorosły" : "Dziecko");
}

function MemberRangeFields({ member, updateMember, agesValid, heightsValid }) {
  const ageRange = ageRangeFor(member.role, member.age);
  const heightRange = heightRangeFor(member.height);
  const ageOptions = member.role === "adult" ? ADULT_AGE_RANGE_OPTIONS : CHILD_AGE_RANGE_OPTIONS;

  return (
    <div className="range-field-grid">
      <label>
        <span>Wiek</span>
        <select
          aria-label={`${memberLabel(member)}: przedział wieku`}
          aria-invalid={!ageRange}
          aria-describedby={!agesValid ? "age-validation-error" : undefined}
          value={ageRange?.value ?? ""}
          onChange={(event) => updateMember(member.id, "age", Number(event.target.value))}
        >
          {!ageRange && <option value="" disabled>Wybierz przedział</option>}
          {ageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label>
        <span>Wzrost</span>
        <select
          aria-label={`${memberLabel(member)}: przedział wzrostu`}
          aria-invalid={!heightRange}
          aria-describedby={!heightsValid ? "height-validation-error" : undefined}
          value={heightRange?.value ?? ""}
          onChange={(event) => updateMember(member.id, "height", Number(event.target.value))}
        >
          {!heightRange && <option value="" disabled>Wybierz przedział</option>}
          {HEIGHT_RANGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
    </div>
  );
}

function offsetDateKey(dateKey, offset) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) return null;
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function planDayDateLabel(plan, dayIndex, short = true) {
  const dateKey = offsetDateKey(plan?.profile?.visitStartDate, dayIndex);
  return dateKey ? formatPolishDay(dateKey, short) : null;
}

function warsawDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function completedNamespaceFor(plan) {
  const generated = new Date(plan?.generatedAt || Date.now());
  const day = plan?.profile?.visitStartDate || warsawDateKey(Number.isFinite(generated.getTime()) ? generated : new Date());
  const party = (plan?.profile?.members || []).map((member) => `${member.role}-${member.age}-${member.height}`).join("_");
  return `${COMPLETED_KEY}:${day}:${party}`.slice(0, 240);
}

function safeSanitizePlan(value) {
  try {
    return sanitizeSharedPlan(value);
  } catch {
    return null;
  }
}

function useUserLocation() {
  const [position, setPosition] = useState(null);
  const [status, setStatus] = useState("idle");
  const watchRef = useRef(null);
  const positionRef = useRef(null);
  const requestRef = useRef(0);

  const clearTracking = useCallback(() => {
    if (watchRef.current != null) navigator.geolocation?.clearWatch(watchRef.current);
    watchRef.current = null;
  }, []);

  const acceptPosition = useCallback((coords) => {
    const nextPosition = positionFromCoordinates(coords);
    if (!nextPosition) return false;
    positionRef.current = nextPosition;
    setPosition(nextPosition);
    setStatus("ready");
    return true;
  }, []);

  const startTracking = useCallback((request) => {
    if (!navigator.geolocation || request !== requestRef.current) return;
    clearTracking();
    watchRef.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        if (request !== requestRef.current) return;
        acceptPosition(coords);
      },
      (error) => {
        if (request !== requestRef.current) return;
        clearTracking();
        const failure = geolocationFailureStatus(error);
        if (failure === "denied") {
          positionRef.current = null;
          setPosition(null);
          setStatus("denied");
          return;
        }
        // A previous fix is more useful than an empty plan while a high-
        // accuracy watcher temporarily loses its signal in the park.
        setStatus(positionRef.current ? "ready" : failure);
      },
      TRACKING_LOCATION_OPTIONS,
    );
  }, [acceptPosition, clearTracking]);

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      positionRef.current = null;
      setPosition(null);
      setStatus("unsupported");
      return;
    }
    const request = requestRef.current + 1;
    requestRef.current = request;
    clearTracking();
    setStatus(positionRef.current ? "refreshing" : "loading");
    try {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          if (request !== requestRef.current) return;
          if (acceptPosition(coords)) startTracking(request);
          else setStatus("error");
        },
        (error) => {
          if (request !== requestRef.current) return;
          const failure = geolocationFailureStatus(error);
          if (failure === "denied") {
            positionRef.current = null;
            setPosition(null);
            setStatus("denied");
            return;
          }
          // The first quick fix can time out indoors or in an embedded iOS
          // view. Try the longer GPS watcher before declaring a failure.
          setStatus(positionRef.current ? "refreshing" : "loading");
          startTracking(request);
        },
        QUICK_LOCATION_OPTIONS,
      );
    } catch {
      setStatus("error");
    }
  }, [acceptPosition, clearTracking, startTracking]);

  useEffect(() => {
    let cancelled = false;
    let permission = null;
    const syncPermission = () => {
      if (cancelled || !permission) return;
      if (permission.state === "granted") {
        if (watchRef.current == null) locate();
      } else if (permission.state === "denied") {
        requestRef.current += 1;
        clearTracking();
        positionRef.current = null;
        setPosition(null);
        setStatus("denied");
      } else {
        if (!positionRef.current) setStatus("idle");
      }
    };
    navigator.permissions?.query?.({ name: "geolocation" }).then((result) => {
      if (cancelled) return;
      permission = result;
      syncPermission();
      permission.addEventListener?.("change", syncPermission);
    }).catch(() => {});
    return () => {
      cancelled = true;
      permission?.removeEventListener?.("change", syncPermission);
      requestRef.current += 1;
      clearTracking();
    };
  }, [clearTracking, locate]);

  return { position, status, locate };
}

function distanceCopy(position, attraction) {
  const meters = distanceMeters(position, attraction);
  const formatted = formatDistance(meters);
  const minutes = approximateWalkingMinutes(meters);
  return formatted && minutes ? `${formatted} · około ${minutes} min pieszo` : null;
}

function Stepper({ label, detail, value, min = 0, max = 8, onChange }) {
  return (
    <div className="stepper-row">
      <span><strong>{label}</strong><small>{detail}</small></span>
      <div className="stepper" aria-label={`${label}: ${value}`}>
        <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`Odejmij: ${label}`}>
          <Minus size={18} weight="bold" />
        </button>
        <strong>{value}</strong>
        <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`Dodaj: ${label}`}>
          <Plus size={18} weight="bold" />
        </button>
      </div>
    </div>
  );
}

function ChoiceCard({ selected, disabled = false, title, detail, icon: Icon, onClick }) {
  return (
    <button className={`choice-card ${selected ? "selected" : ""}`} type="button" disabled={disabled} onClick={onClick} aria-pressed={selected}>
      {Icon && <Icon size={23} weight={selected ? "fill" : "duotone"} aria-hidden="true" />}
      <span><strong>{title}</strong><small>{detail}</small></span>
      <CheckCircle className="choice-check" size={22} weight={selected ? "fill" : "regular"} aria-hidden="true" />
    </button>
  );
}

function WizardIllustration({ step }) {
  const illustration = STEP_ILLUSTRATIONS[step];
  if (!illustration) return null;
  return (
    <figure className="wizard-illustration" key={illustration.file}>
      <img
        src={`${import.meta.env.BASE_URL}assets/onboarding/${illustration.file}`}
        alt={illustration.alt}
        width="960"
        height="640"
        loading="eager"
        decoding="async"
      />
    </figure>
  );
}

function Welcome({ onStart, onBack, onResume, backLabel = "Wróć do początku" }) {
  const headingRef = useRef(null);

  useLayoutEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <main className="welcome-shell screen-app">
      <article className="welcome-material">
        <header>
          <strong>PLAN DLA WAS</strong>
          <button className="welcome-weather-link" type="button" onClick={onBack}><ArrowLeft size={15} weight="bold" /> {backLabel}</button>
        </header>
        <section>
          <p className="eyebrow">NIE KOLEJNY KATALOG ATRAKCJI</p>
          <h1 ref={headingRef} tabIndex="-1">Ułóżmy wam <i>dobry dzień.</i></h1>
          <p>Plan dopasowany do składu, wzrostu, wieku, kolejek i tego, na co naprawdę macie ochotę.</p>
          <figure className="welcome-illustration">
            <img
              src={`${import.meta.env.BASE_URL}assets/welcome-plan-v1.jpg`}
              alt="Filcowa mapa jednej przemyślanej trasy łączącej grupę, wzrost, bezpieczny podział, obiad, pogodę i metę"
              width="1000"
              height="666"
              loading="eager"
              decoding="async"
            />
          </figure>
          <ul className="welcome-benefits" aria-label="Co bierze pod uwagę plan">
            <li><Ruler size={24} weight="duotone" aria-hidden="true" /><span><strong>Ograniczenia każdej osoby</strong><small>Wiek i wzrost sprawdzamy osobno dla wszystkich.</small></span></li>
            <li><ArrowsSplit size={24} weight="duotone" aria-hidden="true" /><span><strong>Bezpieczne podziały grupy</strong><small>Tylko za zgodą i zawsze z uprawnionym dorosłym.</small></span></li>
            <li><ForkKnife size={24} weight="duotone" aria-hidden="true" /><span><strong>Obiad we właściwym miejscu</strong><small>Wpisany w trasę, zamiast przypadkowej przerwy po drodze.</small></span></li>
          </ul>
        </section>
        <footer>
          <button className="primary-button" type="button" onClick={onStart}>Zaczynamy <ArrowRight size={22} weight="bold" /></button>
          {onResume && <button className="resume-button" type="button" onClick={onResume}>Wróć do zapisanego planu</button>}
          <small>Bez konta. Odpowiedzi i lokalizacja zostają w tej przeglądarce.</small>
        </footer>
      </article>
    </main>
  );
}

function Onboarding({ profile, setProfile, step, setStep, onGenerate, queueStatus, queueUpdatedAt, onRefreshQueues, generationError, weatherAssessment }) {
  const headingRef = useRef(null);
  const adults = countByRole(profile.members, "adult");
  const children = countByRole(profile.members, "child");
  const guardians = profile.members.filter(isGuardian).length;
  const updateMember = (id, field, value) => {
    setProfile((current) => ({
      ...current,
      members: current.members.map((member) => member.id === id ? { ...member, [field]: value } : member),
    }));
  };
  const updatePreferences = (patch) => setProfile((current) => ({
    ...current,
    preferences: { ...current.preferences, ...patch },
  }));
  const toggleInterest = (interest) => {
    const current = new Set(profile.preferences.interests);
    if (current.has(interest)) current.delete(interest); else current.add(interest);
    updatePreferences({ interests: [...current] });
  };
  const heightsValid = profile.members.every((member) => Number(member.height) >= 50 && Number(member.height) <= 230);
  const agesValid = profile.members.every((member) => member.role === "adult"
    ? Number(member.age) >= 18 && Number(member.age) <= 110
    : Number(member.age) >= 0 && Number(member.age) <= 17);
  const arrivalMinutes = timeToMinutes(profile.arrivalTime, -1);
  const departureMinutes = timeToMinutes(profile.departureTime, -1);
  const visitTimeValid = arrivalMinutes >= 0 && departureMinutes >= arrivalMinutes + 60;
  const mealMinutes = timeToMinutes(profile.meal?.time, -1);
  const mealTimeValid = profile.meal.mode === "none"
    || (mealMinutes >= arrivalMinutes && mealMinutes <= departureMinutes - 30);
  const effectiveSplitPolicy = guardians < 2 ? "never" : profile.splitPolicy;
  const canContinue = (step !== 0 || visitTimeValid)
    && (step !== 2 || (heightsValid && agesValid && guardians >= 1))
    && (step !== 5 || mealTimeValid);
  const freshness = queueFreshness(queueUpdatedAt);
  const goToStep = useCallback((nextStep) => {
    setStep(Math.max(0, Math.min(STEP_LABELS.length - 1, nextStep)));
  }, [setStep]);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  useEffect(() => {
    const nextIllustration = STEP_ILLUSTRATIONS[step + 1];
    if (!nextIllustration) return undefined;
    const preload = new Image();
    preload.src = `${import.meta.env.BASE_URL}assets/onboarding/${nextIllustration.file}`;
    return () => { preload.onload = null; };
  }, [step]);

  return (
    <main className="onboarding-shell screen-app">
      <header className="wizard-header">
        <button className="icon-button ghost" type="button" aria-label="Wróć" onClick={() => step === 0 ? window.location.reload() : goToStep(step - 1)}>
          <ArrowLeft size={21} weight="bold" />
        </button>
        <div className="wizard-progress-copy">
          <span>{STEP_LABELS[step]} • {step + 1} Z {STEP_LABELS.length}</span>
          <div className="wizard-progress" role="progressbar" aria-label="Postęp konfiguracji planu" aria-valuemin="1" aria-valuemax={STEP_LABELS.length} aria-valuenow={step + 1}><i style={{ width: `${((step + 1) / STEP_LABELS.length) * 100}%` }} /></div>
        </div>
      </header>

      <section className="wizard-step">
        {step === 0 && (
          <>
            <p className="eyebrow">NAJPIERW RAMY DNIA</p>
            <h1 ref={headingRef} tabIndex="-1">Na ile dni przyjeżdżacie?</h1>
            <p className="step-lead">Rozłożymy strefy tak, żeby nie robić trzy razy tej samej pętli.</p>
            <WizardIllustration step={step} />
            {weatherAssessment?.visit?.dayCount && (
              <button className="weather-onboarding-suggestion" type="button" onClick={() => setProfile((current) => ({
                ...current,
                dayCount: weatherAssessment.visit.dayCount,
                visitStartDate: weatherAssessment.visit.selectedDateKeys?.[0] || current.visitStartDate,
              }))}>
                <CloudRain size={22} weight="duotone" />
                <span><small>POGODAPARK PODPOWIADA</small><strong>{weatherAssessment.visit.dayCount} {weatherAssessment.visit.dayCount === 1 ? "dzień" : "dni"} od {weatherAssessment.visit.selectedDateKeys?.[0] ? formatPolishDay(weatherAssessment.visit.selectedDateKeys[0], true) : "najlepszego dnia"}</strong></span>
                <CaretRight size={18} />
              </button>
            )}
            <div className="day-choice-grid">
              {[1, 2, 3].map((days) => (
                <button key={days} className={profile.dayCount === days ? "selected" : ""} type="button" aria-pressed={profile.dayCount === days} onClick={() => setProfile((current) => ({ ...current, dayCount: days }))}>
                  <CalendarBlank size={25} weight={profile.dayCount === days ? "fill" : "duotone"} />
                  <strong>{days}</strong><span>{days === 1 ? "dzień" : "dni"}</span>
                </button>
              ))}
            </div>
            <label className="single-date-field"><span>Od którego dnia</span><input type="date" value={profile.visitStartDate || ""} min={weatherAssessment?.days?.[0]?.dateKey || undefined} onChange={(event) => setProfile((current) => ({ ...current, visitStartDate: event.target.value || null }))} /></label>
            <div className="time-grid">
              <label><span>Wchodzicie około</span><input type="time" value={profile.arrivalTime} onChange={(event) => setProfile((current) => ({ ...current, arrivalTime: event.target.value }))} /></label>
              <label><span>Kończycie około</span><input type="time" value={profile.departureTime} onChange={(event) => setProfile((current) => ({ ...current, departureTime: event.target.value }))} /></label>
            </div>
            {!visitTimeValid && <div className="warning-note" role="alert"><WarningCircle size={21} weight="fill" /><span>Godzina wyjścia musi być co najmniej godzinę po wejściu.</span></div>}
          </>
        )}

        {step === 1 && (
          <>
            <p className="eyebrow">KTO DZIŚ JEDZIE</p>
            <h1 ref={headingRef} tabIndex="-1">W jakim jesteście składzie?</h1>
            <p className="step-lead">Potrzebujemy realnych opiekunów, nie tylko liczby biletów.</p>
            <WizardIllustration step={step} />
            <div className="stepper-panel">
              <Stepper label="Dorośli" detail="pełnoletni opiekunowie" value={adults} min={1} max={6} onChange={(value) => setProfile((current) => ({ ...current, members: resizeMembers(current.members, "adult", value) }))} />
              <Stepper label="Dzieci i nastolatki" detail="każdą osobę opiszemy osobno" value={children} min={0} max={8} onChange={(value) => setProfile((current) => ({ ...current, members: resizeMembers(current.members, "child", value) }))} />
            </div>
            <div className="fact-note"><UsersThree size={20} weight="duotone" /><span><strong>{adults + children} osób</strong><small>{adults} dorosłych · {children} młodszych osób</small></span></div>
          </>
        )}

        {step === 2 && (
          <>
            <p className="eyebrow">BEZPIECZEŃSTWO PRZEDE WSZYSTKIM</p>
            <h1 ref={headingRef} tabIndex="-1">Wiek i wzrost każdej osoby</h1>
            <p className="step-lead">Wybierz przedział, nie wpisuj liczb. Plan liczy dolną granicę zakresu; pomiar przy wejściu zawsze ma ostatnie słowo.</p>
            <WizardIllustration step={step} />
            <div className="member-stack">
              {profile.members.map((member, index) => (
                <article className={`member-card ${member.role}`} key={member.id} role="group" aria-labelledby={`member-title-${member.id}`}>
                  <div className="member-card-title"><span>{index + 1}</span><strong id={`member-title-${member.id}`}>{member.role === "adult" ? "Dorosły" : "Dziecko / nastolatek"}</strong></div>
                  <label className="wide-field"><span>Imię lub skrót — opcjonalnie</span><input type="text" maxLength="40" aria-label={`${memberLabel(member)}: imię lub skrót`} value={member.name} onChange={(event) => updateMember(member.id, "name", event.target.value)} /></label>
                  <MemberRangeFields member={member} updateMember={updateMember} agesValid={agesValid} heightsValid={heightsValid} />
                </article>
              ))}
            </div>
            {!agesValid && <div className="warning-note" id="age-validation-error" role="alert"><WarningCircle size={21} weight="fill" /><span>Wybierz przedział wieku: opiekun ma co najmniej 18 lat, a dziecko lub nastolatek ma 0–17 lat.</span></div>}
            {!heightsValid && <div className="warning-note" id="height-validation-error" role="alert"><WarningCircle size={21} weight="fill" /><span>Wybierz przedział wzrostu dla każdej osoby.</span></div>}
          </>
        )}

        {step === 3 && (
          <>
            <p className="eyebrow">APETYT NA DZIEŃ</p>
            <h1 ref={headingRef} tabIndex="-1">Na co macie ochotę?</h1>
            <p className="step-lead">To nie jest filtr bezpieczeństwa — to sposób, żeby plan był faktycznie wasz.</p>
            <WizardIllustration step={step} />
            <div className="choice-stack compact">
              <ChoiceCard title="Spokojnie" detail="widoki, łagodne przejazdy, więcej oddechu" icon={Sparkle} selected={profile.preferences.intensity === "calm"} onClick={() => updatePreferences({ intensity: "calm" })} />
              <ChoiceCard title="Po trochu" detail="rodzinne hity i kilka mocniejszych rzeczy" icon={Sparkle} selected={profile.preferences.intensity === "mixed"} onClick={() => updatePreferences({ intensity: "mixed" })} />
              <ChoiceCard title="Mocno" detail="flagowe rollercoastery i adrenalina" icon={Sparkle} selected={profile.preferences.intensity === "thrill"} onClick={() => updatePreferences({ intensity: "thrill" })} />
            </div>
            <div className="entertainment-choice">
              <span><small>POZA STAŁĄ TRASĄ</small><strong>Pokazy na żywo</strong><em>Jeśli oficjalny terminarz jest świeży, wpiszemy najwyżej jeden pokaz dziennie — tylko w końcowym buforze, bez zabierania atrakcji ani obiadu.</em></span>
              <button type="button" aria-pressed={profile.entertainment?.includeShows === true} onClick={() => setProfile((current) => ({ ...current, entertainment: { ...current.entertainment, includeShows: !current.entertainment?.includeShows } }))}>{profile.entertainment?.includeShows ? "Tak" : "Nie"}</button>
            </div>
            <h2 className="mini-heading">Co szczególnie lubicie?</h2>
            <div className="interest-grid">
              {[
                ["coasters", "Rollercoastery"],
                ["water", "Wodne"],
                ["family", "Rodzinne"],
                ["scenic", "Widoki i spokój"],
              ].map(([id, label]) => (
                <button key={id} type="button" className={profile.preferences.interests.includes(id) ? "selected" : ""} onClick={() => toggleInterest(id)} aria-pressed={profile.preferences.interests.includes(id)}>{label}</button>
              ))}
            </div>
            <div className="form-section">
              <label className="select-field"><span>Woda</span><select value={profile.preferences.wet} onChange={(event) => updatePreferences({ wet: event.target.value })}><option value="avoid">Wolimy nie moknąć</option><option value="ok">Może być</option><option value="want">Chcemy wodnych</option></select></label>
              <label className="range-field"><span>Maksymalna kolejka <strong>{profile.preferences.maxQueue} min</strong></span><input type="range" min="15" max="90" step="15" value={profile.preferences.maxQueue} onChange={(event) => updatePreferences({ maxQueue: Number(event.target.value) })} /></label>
              <label className="select-field"><span>Tempo</span><select value={profile.pace} onChange={(event) => setProfile((current) => ({ ...current, pace: event.target.value }))}><option value="easy">Spokojne — mniej punktów</option><option value="normal">Normalne</option><option value="fast">Szybkie — więcej atrakcji</option></select></label>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <p className="eyebrow">CZASEM WARTO PÓJŚĆ RÓWNOLEGLE</p>
            <h1 ref={headingRef} tabIndex="-1">Czy możemy rozdzielić grupę?</h1>
            <p className="step-lead">Każde dziecko zostaje z dorosłym. Zawsze podamy wspólne miejsce i godzinę spotkania.</p>
            <WizardIllustration step={step} />
            <div className="choice-stack">
              <ChoiceCard title="Nie — zawsze razem" detail="plan zawiera wyłącznie atrakcje wspólne" icon={UsersThree} selected={effectiveSplitPolicy === "never"} onClick={() => setProfile((current) => ({ ...current, splitPolicy: "never" }))} />
              <ChoiceCard title="Raz, jeśli naprawdę warto" detail="np. Hyperion równolegle z atrakcją dla młodszych" icon={ArrowsSplit} disabled={guardians < 2} selected={effectiveSplitPolicy === "worthwhile"} onClick={() => setProfile((current) => ({ ...current, splitPolicy: "worthwhile" }))} />
              <ChoiceCard title="Tak — pokaż najlepszy wariant" detail="maksymalnie jeden bezpieczny podział dziennie" icon={ArrowsSplit} disabled={guardians < 2} selected={effectiveSplitPolicy === "often"} onClick={() => setProfile((current) => ({ ...current, splitPolicy: "often" }))} />
            </div>
            {guardians < 2 && <div className="warning-note" role="status"><WarningCircle size={21} weight="fill" /><span>Podział wymaga co najmniej dwóch pełnoletnich opiekunów, więc dla tego składu jest wyłączony.</span></div>}
          </>
        )}

        {step === 5 && (
          <>
            <p className="eyebrow">ENERGIA TEŻ JEST OGRANICZENIEM</p>
            <h1 ref={headingRef} tabIndex="-1">Jak jecie w parku?</h1>
            <p className="step-lead">Wstawimy przerwę w logicznym miejscu trasy, zamiast szukać obiadu po drugiej stronie parku.</p>
            <WizardIllustration step={step} />
            <div className="choice-stack compact">
              <ChoiceCard title="Szybko, około 30 minut" detail="pizza lub szybki punkt blisko trasy" icon={ForkKnife} selected={profile.meal.mode === "fast"} onClick={() => setProfile((current) => ({ ...current, meal: { ...current.meal, mode: "fast" } }))} />
              <ChoiceCard title="Spokojny obiad" detail="około godziny i chwila prawdziwego odpoczynku" icon={ForkKnife} selected={profile.meal.mode === "sit-down"} onClick={() => setProfile((current) => ({ ...current, meal: { ...current.meal, mode: "sit-down" } }))} />
              <ChoiceCard title="Mamy swoje jedzenie" detail="zaplanuj tylko przerwę" icon={ForkKnife} selected={profile.meal.mode === "own"} onClick={() => setProfile((current) => ({ ...current, meal: { ...current.meal, mode: "own" } }))} />
              <ChoiceCard title="Bez planowania obiadu" detail="nie dodawaj przerwy do osi dnia" icon={ForkKnife} selected={profile.meal.mode === "none"} onClick={() => setProfile((current) => ({ ...current, meal: { ...current.meal, mode: "none" } }))} />
            </div>
            {profile.meal.mode !== "none" && <label className="single-time-field"><span>Najlepiej około</span><input type="time" value={profile.meal.time} onChange={(event) => setProfile((current) => ({ ...current, meal: { ...current.meal, time: event.target.value } }))} /></label>}
            {!mealTimeValid && <div className="warning-note" role="alert"><WarningCircle size={21} weight="fill" /><span>Wybierz porę posiłku mieszczącą się w godzinach wizyty.</span></div>}
          </>
        )}

        {step === 6 && (
          <>
            <p className="eyebrow">OSTATNIE SPOJRZENIE</p>
            <h1 ref={headingRef} tabIndex="-1">Dobrze was rozumiemy?</h1>
            <p className="step-lead">Plan najpierw pilnuje ograniczeń, później wspólnej zabawy, kolejek i marszu.</p>
            <WizardIllustration step={step} />
            <div className="review-card">
              <div><CalendarBlank size={22} weight="duotone" /><span><strong>{profile.dayCount} {profile.dayCount === 1 ? "dzień" : "dni"}{profile.visitStartDate ? ` od ${formatPolishDay(profile.visitStartDate, true)}` : ""}</strong><small>{profile.arrivalTime}–{profile.departureTime} · tempo {profile.pace === "easy" ? "spokojne" : profile.pace === "fast" ? "szybkie" : "normalne"}</small></span></div>
              <div><UsersThree size={22} weight="duotone" /><span><strong>{profile.members.length} osób</strong><small>{profile.members.map((member) => `${memberLabel(member)}: ${ageRangeLabel(member.role, member.age)} · ${heightRangeLabel(member.height)}`).join(" · ")}</small></span></div>
              <div><Sparkle size={22} weight="duotone" /><span><strong>{profile.preferences.intensity === "thrill" ? "Mocny dzień" : profile.preferences.intensity === "calm" ? "Spokojny dzień" : "Po trochu"}</strong><small>kolejki do {profile.preferences.maxQueue} min · woda: {profile.preferences.wet === "avoid" ? "nie" : profile.preferences.wet === "want" ? "tak" : "może być"}</small></span></div>
              <div><ArrowsSplit size={22} weight="duotone" /><span><strong>{effectiveSplitPolicy === "never" ? "Zawsze razem" : effectiveSplitPolicy === "often" ? "Podział dozwolony" : "Jeden wartościowy podział"}</strong><small>{profile.meal.mode === "none" ? "bez zaplanowanego obiadu" : `obiad około ${profile.meal.time}`}</small></span></div>
              <div><CalendarBlank size={22} weight="duotone" /><span><strong>{profile.entertainment?.includeShows ? "Sprawdź pokazy na żywo" : "Bez pokazów w trasie"}</strong><small>{profile.entertainment?.includeShows ? "Tylko świeży oficjalny terminarz i tylko bez skracania dnia." : "Możesz zmienić to w kroku „Apetyt”."}</small></span></div>
            </div>
            <button className="edit-review" type="button" onClick={() => goToStep(0)}><PencilSimple size={18} /> Popraw odpowiedzi</button>
            {generationError && <div className="warning-note" role="alert"><WarningCircle size={21} weight="fill" /><span><strong>Nie ma teraz bezpiecznej trasy dla tych ustawień.</strong><br />{generationError}</span></div>}
            <p className="data-status" role="status"><span className={queueStatus === "ready" && freshness.state === "fresh" ? "ready" : ""} />{queueStatus === "loading" ? "Pobieram aktualne kolejki…" : queueStatus === "ready" ? `Migawka kolejek: ${freshness.label}${freshness.state === "stale" ? " — może być nieaktualna" : ""}.` : queueStatus === "stale" ? `Nie udało się odświeżyć; zachowuję ostatnią migawkę z ${freshness.label}.` : "Plan powstanie bez danych o kolejce."}</p>
            <button className="edit-review" type="button" disabled={queueStatus === "loading"} onClick={onRefreshQueues}><Clock size={18} /> Odśwież kolejki</button>
          </>
        )}
      </section>

      <footer className="wizard-footer">
        {step < STEP_LABELS.length - 1 ? (
          <button className="primary-button" type="button" disabled={!canContinue} onClick={() => goToStep(step + 1)}>Dalej <ArrowRight size={20} weight="bold" /></button>
        ) : (
          <button className="primary-button generate" type="button" onClick={onGenerate}><Sparkle size={20} weight="fill" /> Ułóż plan</button>
        )}
      </footer>
    </main>
  );
}

function DetailSheet({ attraction, sequence, memberIds, members, onClose }) {
  const sheetRef = useRef(null);
  const closeRef = useRef(null);
  const previousFocusRef = useRef(null);
  const [imageFailed, setImageFailed] = useState(false);
  const details = detailsForAttraction(attraction);
  const links = createWalkingMapLinks(attraction);
  const riders = members.filter((member) => memberIds.includes(member.id));

  useEffect(() => setImageFailed(false), [attraction.id]);

  useLayoutEffect(() => {
    previousFocusRef.current = document.activeElement;
    const sheet = sheetRef.current;
    const reset = () => { if (sheet) sheet.scrollTop = 0; };
    const focus = () => { reset(); closeRef.current?.focus({ preventScroll: true }); reset(); };
    const timeout = window.setTimeout(focus, 260);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeys = (event) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !sheet) return;
      const focusable = [...sheet.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    sheet?.addEventListener("animationend", focus, { once: true });
    document.addEventListener("keydown", handleKeys);
    return () => {
      window.clearTimeout(timeout);
      sheet?.removeEventListener("animationend", focus);
      document.removeEventListener("keydown", handleKeys);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, [attraction.id, onClose]);

  if (!links) return null;
  return (
    <div className="sheet-layer">
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <section ref={sheetRef} className="detail-sheet" role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <div className="sheet-handle" />
        <header><div><p className="eyebrow">ATRAKCJA {sequence} • {zoneLabel(attraction.zone)}</p><h2 id="detail-title">{attraction.name}</h2></div><button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label="Zamknij"><X size={22} weight="bold" /></button></header>
        {!imageFailed && details.imageUrl ? <figure className="detail-photo"><img src={details.imageUrl} alt={`${attraction.name} — oficjalne zdjęcie Energylandii`} onError={() => setImageFailed(true)} /><figcaption>OFICJALNE ZDJĘCIE • ENERGYLANDIA</figcaption></figure> : <div className="detail-photo fallback"><Sparkle size={30} /><span>Zdjęcie chwilowo niedostępne</span></div>}
        <div className="detail-restriction"><span>{sequence}</span><div><strong>{attractionLabel(attraction)}</strong><small>zweryfikowano {VERIFIED_AT}</small></div></div>
        <p className="detail-summary">{details.summary}</p>
        <div className="rider-strip"><strong>Ten punkt planu:</strong><span>{riders.map(memberLabel).join(" · ")}</span></div>
        <a className="official-link" href={attraction.sourceUrl} target="_blank" rel="noreferrer"><span><strong>Oficjalne ograniczenia i opis</strong><small>Energylandia — źródło reguł</small></span><CaretRight size={18} /></a>
        <p className="navigation-label">PROWADŹ NAS</p>
        <div className="map-link-grid">
          <a href={links.appleMapsUrl} target="_blank" rel="noreferrer"><AppleLogo size={28} weight="fill" /><span><strong>Apple Maps</strong><small>pieszo z pozycji telefonu</small></span></a>
          <a className="google" href={links.googleMapsUrl} target="_blank" rel="noreferrer"><GoogleLogo size={28} weight="bold" /><span><strong>Google Maps</strong><small>pieszo z pozycji telefonu</small></span></a>
        </div>
        <p className="sheet-note">Plan jest podpowiedzią. Pomiar, tablica przy atrakcji oraz decyzja obsługi zawsze mają pierwszeństwo.</p>
      </section>
    </div>
  );
}

function annotatedDay(day) {
  let sequence = 0;
  return {
    ...day,
    steps: day.steps.map((step) => {
      if (step.kind !== "ride" && step.kind !== "split") return step;
      sequence += 1;
      return { ...step, sequence };
    }),
  };
}

function planMapItems(day) {
  return day.steps.flatMap((step) => {
    if (step.kind === "ride") {
      const ride = ALL_ATTRACTIONS_BY_ID[step.attractionId];
      return ride ? [{ ...ride, sequence: step.sequence, markerKind: "together" }] : [];
    }
    if (step.kind === "split") {
      return step.assignments.flatMap((assignment, index) => {
        const ride = ALL_ATTRACTIONS_BY_ID[assignment.attractionId];
        return ride ? [{ ...ride, sequence: `${step.sequence}${index === 0 ? "A" : "B"}`, markerKind: "split" }] : [];
      });
    }
    return [];
  });
}

const PRINT_DAY_ART = ["07-podsumowanie.jpg", "04-apetyt.jpg", "01-czas.jpg"];

function PrintablePlan({ plan, planUrl, preview = false }) {
  if (!plan) return null;
  const generatedLabel = new Date(plan.generatedAt).toLocaleString("pl-PL", { dateStyle: "long", timeStyle: "short" });
  const visitDates = plan.days.map((_, index) => planDayDateLabel(plan, index, false)).filter(Boolean);
  const visitHours = plan.days[0]?.stats ? `${plan.days[0].stats.start}–${plan.days[0].stats.end}` : `${plan.profile.arrivalTime}–${plan.profile.departureTime}`;
  return (
    <article className={`print-plan ${preview ? "is-preview" : ""}`} aria-label="Podgląd dokumentu PDF">
      <section className="pdf-page pdf-cover-page">
        <header className="pdf-brandline">
          <span className="pdf-brand"><img src={`${import.meta.env.BASE_URL}icon-192-v3.png`} alt="" /><span><strong>PogodaPark</strong><small>ENERGYLANDIA • PLAN DLA WAS</small></span></span>
          <span className="pdf-edition">WASZA TRASA • {plan.days.length} {plan.days.length === 1 ? "DZIEŃ" : "DNI"}</span>
        </header>

        <div className="pdf-cover-copy">
          <p>NIE KATALOG ATRAKCJI. PLAN, KTÓRY PILNUJE CAŁEJ GRUPY.</p>
          <h1>Wasza Energylandia.<br /><i>Dobrze ułożona.</i></h1>
          <span>{visitDates.length ? visitDates.join(" • ") : "Wybrany termin"} · {visitHours}</span>
        </div>

        <figure className="pdf-cover-hero">
          <img src={`${import.meta.env.BASE_URL}assets/welcome-plan-v1.jpg`} alt="Filcowa mapa zaplanowanego dnia" />
          <figcaption>SKŁAD • OGRANICZENIA • POGODA • OBIAD • META</figcaption>
        </figure>

        <div className="pdf-fact-grid">
          <div><small>DNI</small><strong>{plan.days.length}</strong><span>{visitDates[0] || "termin w planie"}</span></div>
          <div><small>GRUPA</small><strong>{plan.profile.members.length}</strong><span>{plan.profile.members.filter((member) => member.role === "adult").length} dorosłych</span></div>
          <div><small>GODZINY</small><strong>{visitHours}</strong><span>pełny zadeklarowany dzień</span></div>
        </div>

        <div className="pdf-party-panel">
          <figure><img src={`${import.meta.env.BASE_URL}assets/onboarding/02-sklad.jpg`} alt="Filcowa grupa uczestników" /></figure>
          <section><p className="pdf-kicker">SKŁAD I OGRANICZENIA</p><h2>Każda osoba policzona osobno.</h2><ul>{plan.profile.members.map((member) => <li key={member.id}><strong>{memberLabel(member)}</strong><span>{ageRangeLabel(member.role, member.age)} · {heightRangeLabel(member.height)}</span></li>)}</ul></section>
        </div>

        <aside className="pdf-live-note"><strong>Ten dokument jest mapą dnia, nie danymi na żywo.</strong><span>Kolejki, pogoda i alert Antistorm zmieniają się — przed kolejnym punktem otwórzcie żywy plan z linku na dole.</span></aside>
        <footer className="pdf-page-footer"><span>Wygenerowano {generatedLabel}</span><span>01</span></footer>
      </section>

      {plan.days.map((rawDay, dayIndex) => {
        const day = annotatedDay(rawDay);
        const dateLabel = planDayDateLabel(plan, dayIndex, false);
        const attractionCount = day.steps.reduce((count, step) => count + (step.kind === "ride" ? 1 : step.kind === "split" ? step.assignments.length : 0), 0);
        return <section className="pdf-page pdf-day-page" key={day.day}>
          <header className="pdf-brandline"><span className="pdf-brand compact"><img src={`${import.meta.env.BASE_URL}icon-192-v3.png`} alt="" /><span><strong>PogodaPark</strong><small>PLAN DLA WAS</small></span></span><span className="pdf-edition">DZIEŃ {day.day ?? dayIndex + 1} Z {plan.days.length}</span></header>
          <div className="pdf-day-heading"><div><p>{dateLabel || `Dzień ${dayIndex + 1}`}</p><h2>{day.label || `Dzień ${dayIndex + 1}`}</h2></div><strong>{day.stats.start}<i>–</i>{day.stats.end}</strong></div>
          <figure className="pdf-day-hero"><img src={`${import.meta.env.BASE_URL}assets/onboarding/${PRINT_DAY_ART[dayIndex % PRINT_DAY_ART.length]}`} alt="Filcowa mapa dnia" /><figcaption><span><strong>{attractionCount}</strong> atrakcji</span><span><strong>~{day.stats.walkingMinutes}</strong> min marszu</span><span><strong>{day.stats.start}–{day.stats.end}</strong> pełny dzień</span></figcaption></figure>
          <div className="pdf-timeline">
            {day.steps.map((step) => {
              if (step.kind === "meal") return <div className="pdf-step meal" key={step.id}><img src={`${import.meta.env.BASE_URL}assets/onboarding/06-obiad.jpg`} alt="" /><strong>{formatPlanTime(step.startMin)}<small>OBIAD</small></strong><span><b>{step.title}</b><small>{step.description}</small></span></div>;
              if (step.kind === "show") return <div className="pdf-step show" key={step.id}><img src={`${import.meta.env.BASE_URL}assets/onboarding/04-apetyt.jpg`} alt="" /><strong>{formatPlanTime(step.performanceStartMin)}<small>POKAZ • {step.durationMinutes} MIN</small></strong><span><b>{step.title}</b><small>{step.venue} · {step.description}</small></span></div>;
              if (step.kind === "flex") return <div className="pdf-step flex" key={step.id}><img src={`${import.meta.env.BASE_URL}assets/onboarding/01-czas.jpg`} alt="" /><strong>{formatPlanTime(step.startMin)}<small>DO {formatPlanTime(step.unplannedUntil ?? step.endMin)}</small></strong><span><b>{step.title}</b><small>{step.description}</small></span></div>;
              if (step.kind === "ride") { const ride = ALL_ATTRACTIONS_BY_ID[step.attractionId]; return <div className="pdf-step ride" key={step.id}><i>{step.sequence}</i><strong>{formatPlanTime(step.startMin)}<small>WSZYSCY</small></strong><span><b>{ride.name}</b><small>{zoneLabel(ride.zone)} · {attractionLabel(ride)}</small></span></div>; }
              return <div className="pdf-step split" key={step.id}><img src={`${import.meta.env.BASE_URL}assets/onboarding/05-podzial.jpg`} alt="" /><strong>{formatPlanTime(step.startMin)}<small>PODZIAŁ {step.sequence}</small></strong><span>{step.assignments.map((assignment) => { const ride = ALL_ATTRACTIONS_BY_ID[assignment.attractionId]; return <b key={assignment.attractionId}>{assignment.label}: {ride.name}<small>{assignment.memberIds.map((id) => memberLabel(plan.profile.members.find((member) => member.id === id))).join(", ")}</small></b>; })}<em>Spotkanie {step.reunion.time}: {step.reunion.label}</em></span></div>;
            })}
          </div>
          <aside className="pdf-day-reminder"><strong>Bufor jest częścią planu.</strong><span>Jeśli atrakcje pójdą szybciej, wykorzystajcie wolny czas na WC, odpoczynek albo jedną z propozycji zapasowych — nie skracajcie dnia w ciemno.</span></aside>
          <footer className="pdf-page-footer"><span>Pełne opisy, prowadzenie i aktualne dane: <a href={planUrl}>otwórz żywy plan</a></span><span>{String(dayIndex + 2).padStart(2, "0")}</span></footer>
        </section>;
      })}
    </article>
  );
}

function PdfPreview({ plan, planUrl, onClose }) {
  const closeRef = useRef(null);
  const [preparing, setPreparing] = useState(false);

  useLayoutEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const printDocument = async () => {
    setPreparing(true);
    try {
      await document.fonts?.ready;
      const images = [...document.querySelectorAll(".pdf-preview-layer .print-plan img")];
      await Promise.all(images.map((image) => image.complete ? image.decode?.().catch(() => {}) : new Promise((resolve) => { image.addEventListener("load", resolve, { once: true }); image.addEventListener("error", resolve, { once: true }); })));
      window.print();
    } finally {
      setPreparing(false);
    }
  };

  return (
    <section className="pdf-preview-layer" role="dialog" aria-modal="true" aria-label="Podgląd dokumentu PDF">
      <header className="pdf-preview-toolbar"><button ref={closeRef} type="button" onClick={onClose}><ArrowLeft size={19} weight="bold" /> Wróć do planu</button><span><strong>Wasz piękny PDF</strong><small>Podgląd stron A4</small></span><button className="pdf-print-action" type="button" onClick={printDocument} disabled={preparing}><Printer size={19} weight="bold" /> {preparing ? "Przygotowuję…" : "Drukuj / zapisz"}</button></header>
      <div className="pdf-preview-scroll"><PrintablePlan plan={plan} planUrl={planUrl} preview /></div>
    </section>
  );
}

function ShowSchedulePanel({ plan, day, selectedDay, schedule, status, onRefresh, onToggle }) {
  const includeShows = plan.profile?.entertainment?.includeShows === true;
  // Older saved plans did not persist a visit date. Keep their calendar useful
  // by treating the selected tab as today rather than presenting a false
  // "broken calendar" state.
  const dateKey = offsetDateKey(plan.profile?.visitStartDate || warsawDateKey(), selectedDay);
  const freshness = showScheduleFreshness(schedule);
  const availability = showDateAvailability(schedule, dateKey);
  const availableShows = availability.shows;
  const scheduledShow = day.steps.find((step) => step.kind === "show") ?? null;
  const sourceUrl = schedule?.source?.url || OFFICIAL_SHOW_INDEX;
  const refreshLabel = status === "loading" ? "Odświeżam…" : "Odśwież terminarz";
  const selectedDateLabel = planDayDateLabel(plan, selectedDay, true) || (dateKey ? formatPolishDay(dateKey, true) : "wybrany dzień");
  const rangeLabel = availability.range
    ? `${formatPolishDay(availability.range.from, true)}–${formatPolishDay(availability.range.to, true)}`
    : null;
  const emptyCalendarCopy = availability.state === "outside-range"
    ? `Oficjalna migawka obejmuje teraz ${rangeLabel}. Dla ${selectedDateLabel} Energylandia nie opublikowała jeszcze godzin — sprawdź oficjalną rozpiskę.`
    : availability.state === "retained-stale"
      ? `W tej dacie zostały tylko niepełne, starsze wpisy. Nie pokazujemy ich jako aktualnego kalendarza; sprawdź oficjalną rozpiskę.`
      : availability.state === "no-events"
        ? `Na ${selectedDateLabel} w aktualnej oficjalnej rozpisce nie ma dodatkowych pokazów.`
        : `Nie udało się pobrać kompletnej rozpiski dla ${selectedDateLabel}. Sprawdź oficjalną stronę Energylandii.`;

  return (
    <section className="shows-section" aria-labelledby="shows-title">
      <div className="section-heading shows-heading">
        <div><p className="eyebrow">DYSKRETNY DODATEK</p><h2 id="shows-title">Pokazy na żywo</h2></div>
        <button className={includeShows ? "active" : ""} type="button" aria-pressed={includeShows} onClick={() => onToggle(!includeShows)}>{includeShows ? "W trasie" : "Dodaj"}</button>
      </div>
      <p className="shows-intro">Nie układamy dnia wokół sceny. Gdy tego chcecie, używamy świeżego oficjalnego terminarza i proponujemy najwyżej jeden pokaz dopiero w końcowym buforze.</p>
      <div className={`shows-source ${freshness.state}`}>
        <span><CalendarBlank size={20} weight="duotone" /></span>
        <p><strong>Oficjalny terminarz Energylandii</strong><small>{status === "loading" ? "Sprawdzam aktualną migawkę…" : freshness.state === "fresh" ? freshness.label : `${freshness.label} — nie wpisuję godzin automatycznie.`}</small></p>
        <button type="button" onClick={onRefresh} disabled={status === "loading"}><ArrowClockwise className={status === "loading" ? "spin" : ""} size={18} weight="bold" /> <span>{refreshLabel}</span></button>
      </div>
      {!includeShows && <p className="shows-muted">Pokazy nie wejdą do trasy, ale kalendarz poniżej nadal możecie sprawdzić. Włącz „Dodaj”, jeśli planer ma pilnować terminów show.</p>}
      {includeShows && freshness.state !== "fresh" && <p className="shows-warning"><WarningCircle size={18} weight="fill" /><span>Terminarz ma teraz status „{freshness.label}”, więc nie wpisujemy godzin automatycznie. Ostatnią opublikowaną rozpiskę nadal pokazujemy niżej — przed wyjściem sprawdź <a href={sourceUrl} target="_blank" rel="noreferrer">oficjalny terminarz</a> i tablice w parku.</span></p>}
      {includeShows && freshness.state === "fresh" && (
        <>
          {scheduledShow ? <article className="scheduled-show"><div><span className="show-time">{formatPlanTime(scheduledShow.performanceStartMin)}</span><p><small>WPISANE W KOŃCOWY BUFOR • {scheduledShow.durationMinutes} MIN</small><strong>{scheduledShow.title}</strong><em>{scheduledShow.venue}</em></p></div><a href={scheduledShow.officialUrl} target="_blank" rel="noreferrer">Oficjalny opis <CaretRight size={17} /></a></article> : <p className="shows-muted">Na {selectedDateLabel} nie ma jeszcze pokazu, który zmieści się bez naruszania atrakcji, obiadu i godzinnego buforu wyjścia. Niczego nie wciskamy na siłę.</p>}
        </>
      )}
      {availableShows.length > 0 ? <details className="show-list"><summary><span><strong>{availableShows.length} pokazów w oficjalnej rozpisce</strong><small>{selectedDateLabel} · otwórz opisy, miejsca i godziny</small></span><CaretRight size={18} /></summary><div>{availableShows.map((show) => <article className="show-card" key={show.id}>{show.imageUrl && <img src={show.imageUrl} alt={`${show.title} — oficjalne zdjęcie Energylandii`} loading="lazy" />}<span><p><strong>{show.title}</strong><small>{show.venue} · {show.durationMinutes} min</small></p><p className="show-times">{show.times.join(" · ")}</p><p className="show-description">{show.description || "Oficjalny opis jest dostępny na stronie Energylandii."}</p><p className="show-links"><a href={show.url} target="_blank" rel="noreferrer">Opis Energylandii</a>{show.mapUrl && <a href={show.mapUrl} target="_blank" rel="noreferrer">Pokaż na mapie parku</a>}</p></span></article>)}</div></details> : <p className="shows-muted">{emptyCalendarCopy} <a href={sourceUrl} target="_blank" rel="noreferrer">Otwórz terminarz Energylandii.</a></p>}
      <p className="shows-note">{schedule?.source?.note || "Godziny mogą zmienić się operacyjnie — przed pokazem sprawdź również tablice na miejscu."}</p>
    </section>
  );
}

function SharedPlanStatus({ status, error, onRetry, onStart }) {
  const headingRef = useRef(null);
  const loading = status === "loading";

  useLayoutEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [status]);

  return (
    <main className="welcome-shell screen-app">
      <article className="welcome-material">
        <header>
          <strong>UDOSTĘPNIONY PLAN</strong>
          <button className="welcome-weather-link" type="button" onClick={onStart}><ArrowLeft size={15} weight="bold" /> Do początku</button>
        </header>
        <section aria-live="polite">
          <p className="eyebrow">KRÓTKI LINK • POGODAPARK</p>
          <h1 ref={headingRef} tabIndex="-1">{loading ? <>Otwieram <i>wasz plan.</i></> : <>Nie mogę otworzyć <i>tego planu.</i></>}</h1>
          <p>{loading
            ? "Pobieram bezpiecznie zapisany plan. Za chwilę zobaczycie trasę, pogodę i kolejki."
            : error || "Krótki link jest niepełny albo plan nie jest już dostępny."}</p>
        </section>
        <footer>
          {loading
            ? <span className="resume-button" role="status">Łączę z planem…</span>
            : <button className="primary-button" type="button" onClick={onRetry}><ArrowClockwise size={20} weight="bold" /> Spróbuj ponownie</button>}
          {!loading && <button className="resume-button" type="button" onClick={onStart}>Ułóż nowy plan</button>}
          <small>{loading ? "Krótki link nie zawiera danych w adresie komunikatora." : "Jeśli link dostałeś w wiadomości, poproś nadawcę o skopiowanie go jeszcze raz."}</small>
        </footer>
      </article>
    </main>
  );
}

function PlanView({ plan, initialShortPlanUrl = "", onEdit, onReanalyze, weatherAssessment, weatherStatus, onRefreshWeather, showSchedule, showStatus, onRefreshShows, onToggleShows }) {
  const planHeadingRef = useRef(null);
  const [selectedDay, setSelectedDay] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [showToilets, setShowToilets] = useState(false);
  const { position, status: locationStatus, locate } = useUserLocation();
  const completedKey = useMemo(() => completedNamespaceFor(plan), [plan]);
  const [completedIds, setCompletedIds] = useState(() => {
    const stored = readStored(completedKey, []);
    return Array.isArray(stored) ? [...new Set(stored.filter((id) => ALL_ATTRACTIONS_BY_ID[id]))] : [];
  });
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [reanalyzing, setReanalyzing] = useState(false);
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [shortPlanUrl, setShortPlanUrl] = useState(initialShortPlanUrl);
  const [shortLinkStatus, setShortLinkStatus] = useState(initialShortPlanUrl ? "ready" : "idle");
  const [shortLinkError, setShortLinkError] = useState("");
  const [showLocalFallback, setShowLocalFallback] = useState(false);
  const shareUrlRef = useRef(null);
  const shortLinkPromiseRef = useRef(null);
  const day = annotatedDay(plan.days[selectedDay] ?? plan.days[0] ?? { steps: [], stats: {} });
  const mapItems = planMapItems(day);
  const compactPlanUrl = useMemo(() => createPlanUrl(plan), [plan]);
  const planUrl = shortPlanUrl || compactPlanUrl;
  const compactPlanUrlRef = useRef(compactPlanUrl);
  const dayAttractionIds = day.steps.flatMap((step) => {
    if (step.kind === "ride") return [step.attractionId];
    if (step.kind === "split") return step.assignments.map((assignment) => assignment.attractionId);
    return [];
  });
  const nextAttractionId = dayAttractionIds.find((id) => !completedIds.includes(id));
  const firstRide = ALL_ATTRACTIONS_BY_ID[nextAttractionId];
  const firstRideDistance = firstRide ? distanceCopy(position, firstRide) : null;
  const isLocating = locationStatus === "loading" || locationStatus === "refreshing";
  const locationAccuracy = Number.isFinite(position?.accuracy) ? Math.round(position.accuracy) : null;
  const locationButtonLabel = isLocating
    ? (locationStatus === "refreshing" ? "Odświeżam GPS…" : "Ustalam GPS…")
    : locationStatus === "ready" ? "Odśwież GPS"
      : locationStatus === "timeout" || locationStatus === "error" ? "Spróbuj GPS ponownie"
        : "Włącz GPS";
  const completedToday = dayAttractionIds.filter((id) => completedIds.includes(id)).length;
  const queueSnapshot = queueFreshness(plan.queueSnapshotAt);
  const selectedAttraction = selectedId ? ALL_ATTRACTIONS_BY_ID[selectedId] : null;
  const selectedMapItem = mapItems.find((item) => item.id === selectedId);
  const selectedAssignment = day.steps.flatMap((step) => {
    if (step.kind === "ride" && step.attractionId === selectedId) return [{ memberIds: step.memberIds, sequence: step.sequence }];
    if (step.kind === "split") return step.assignments.flatMap((assignment, index) => assignment.attractionId === selectedId ? [{ memberIds: assignment.memberIds, sequence: `${step.sequence}${index === 0 ? "A" : "B"}` }] : []);
    return [];
  })[0] ?? { memberIds: plan.profile.members.map((member) => member.id), sequence: selectedMapItem?.sequence ?? "" };

  useLayoutEffect(() => {
    planHeadingRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => writeStored(completedKey, completedIds), [completedIds, completedKey]);
  useEffect(() => { if (notice) { const timeout = window.setTimeout(() => setNotice(""), 2400); return () => window.clearTimeout(timeout); } return undefined; }, [notice]);
  useEffect(() => setSelectedId(null), [selectedDay]);
  useEffect(() => {
    if (!showLocalFallback) return undefined;
    const frame = window.requestAnimationFrame(() => {
      shareUrlRef.current?.focus();
      shareUrlRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [showLocalFallback]);
  useEffect(() => {
    if (compactPlanUrlRef.current === compactPlanUrl) return;
    compactPlanUrlRef.current = compactPlanUrl;
    shortLinkPromiseRef.current = null;
    setShortPlanUrl("");
    setShortLinkStatus("idle");
    setShortLinkError("");
    setShowLocalFallback(false);
  }, [compactPlanUrl]);

  const toggleCompleted = (id) => {
    const attraction = ALL_ATTRACTIONS_BY_ID[id];
    const wasCompleted = completedIds.includes(id);
    setCompletedIds((current) => wasCompleted ? current.filter((item) => item !== id) : [...current, id]);
    setNotice(wasCompleted ? `Przywrócono: ${attraction?.name ?? "atrakcja"}` : `Zaliczone: ${attraction?.name ?? "atrakcja"}`);
  };
  const closeDetail = useCallback(() => setSelectedId(null), []);
  const handleReanalyze = async () => {
    if (reanalyzing) return;
    setReanalyzing(true);
    try {
      await onReanalyze();
      setNotice("Plan przeliczony na świeżych kolejkach");
    } finally {
      setReanalyzing(false);
    }
  };
  const ensureShortPlanUrl = useCallback(async () => {
    if (shortPlanUrl) return shortPlanUrl;
    if (shortLinkPromiseRef.current) return shortLinkPromiseRef.current;
    setShortLinkStatus("loading");
    setShortLinkError("");
    const task = createShortPlanLink(plan)
      .then((url) => {
        setShortPlanUrl(url);
        setShortLinkStatus("ready");
        setShowLocalFallback(false);
        return url;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Nie udało się utworzyć krótkiego linku.";
        setShortLinkStatus("error");
        setShortLinkError(message);
        throw error;
      })
      .finally(() => { shortLinkPromiseRef.current = null; });
    shortLinkPromiseRef.current = task;
    return task;
  }, [plan, shortPlanUrl]);
  const share = async () => {
    try {
      const url = await ensureShortPlanUrl();
      if (navigator.share) {
        await navigator.share({ url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setNotice("Krótki link skopiowany");
    } catch (error) {
      if (error?.name !== "AbortError") setNotice("Nie udało się otworzyć udostępniania");
    }
  };
  const copy = async () => {
    try {
      const url = await ensureShortPlanUrl();
      await navigator.clipboard.writeText(url);
      setNotice("Krótki link skopiowany");
    } catch {
      setNotice("Nie udało się utworzyć krótkiego linku");
    }
  };
  const copyLocalFallback = async () => {
    try {
      await navigator.clipboard.writeText(compactPlanUrl);
      setNotice("Skopiowano lokalny, długi link");
    } catch {
      setShowLocalFallback(true);
      setNotice("Lokalny link zaznaczony — wybierz Kopiuj");
    }
  };
  const openEmail = async (event) => {
    event.preventDefault();
    if (!email || !event.currentTarget.reportValidity()) return;
    try {
      const url = await ensureShortPlanUrl();
      window.location.href = createEmailDraftUrl(email, url, plan);
    } catch {
      setNotice("Nie udało się utworzyć krótkiego linku do e-maila");
    }
  };

  return (
    <>
      <main className="plan-shell screen-app">
        <header className="plan-topbar"><div><p className="eyebrow">PLAN DLA WAS</p><h1 ref={planHeadingRef} tabIndex="-1">Wasza Energylandia</h1></div><div className="plan-topbar-actions"><button type="button" onClick={handleReanalyze} disabled={reanalyzing}><ArrowClockwise className={reanalyzing ? "spin" : ""} size={17} /> {reanalyzing ? "Liczę…" : "Przelicz"}</button><button type="button" onClick={onEdit}><PencilSimple size={17} /> Zmień</button></div></header>
        {!plan.safety?.valid && <div className="safety-alert"><WarningCircle size={22} weight="fill" /><span><strong>Plan wymaga poprawy</strong><small>{plan.safety?.issues?.[0]}</small></span></div>}
        <RainSafetyCard assessment={weatherAssessment} status={weatherStatus} onRefresh={onRefreshWeather} compact />
        <section className="plan-hero" aria-live="polite">
          <p>DZIEŃ {day.day ?? selectedDay + 1} Z {plan.days.length} • {plan.profile.members.length} OSÓB</p>
          <h2>{firstRide ? <>{completedToday > 0 ? "Teraz czas na" : "Zacznijcie od"}<br /><em>{firstRide.name}</em></> : `Dzień ${day.day ?? selectedDay + 1} zaliczony`}</h2>
          <span>{firstRide ? "Najpierw bezpieczeństwo, potem zgodność z waszym apetytem, kolejki i logiczny marsz." : "Wszystkie atrakcje zaplanowane na ten dzień są już oznaczone jako zaliczone."}</span>
          {firstRideDistance && <small className="hero-distance"><Footprints size={16} weight="duotone" /> <strong>Od was:</strong> {firstRideDistance}</small>}
          {firstRide && !firstRideDistance && locationStatus !== "denied" && locationStatus !== "unsupported" && <button className="hero-location-button" type="button" onClick={locate} disabled={isLocating}><Crosshair size={18} weight="bold" /><span><strong>{isLocating ? "Szukam waszej pozycji…" : locationStatus === "timeout" || locationStatus === "error" ? "Spróbuj ustalić pozycję" : "Włącz lokalizację"}</strong><small>{isLocating ? "Za chwilę pokażę metry do każdej atrakcji." : "Pokażę metry i czas dojścia do każdej atrakcji."}</small></span></button>}
          {firstRide && <button className="hero-next-button" type="button" aria-haspopup="dialog" onClick={() => setSelectedId(firstRide.id)}>Opis i prowadzenie <CaretRight size={18} /></button>}
        </section>
        <nav className="day-tabs" aria-label="Dni planu">{plan.days.map((item, index) => { const dateLabel = planDayDateLabel(plan, index, true); return <button key={item.day} type="button" className={selectedDay === index ? "selected" : ""} aria-pressed={selectedDay === index} aria-current={selectedDay === index ? "step" : undefined} onClick={() => { setSelectedDay(index); setNotice(`Pokazuję dzień ${item.day}`); }}>Dzień {item.day}<small>{dateLabel ? `${dateLabel} · ` : ""}{item.stats.attractions} atrakcji</small></button>; })}</nav>

        <section className="plan-map-card" aria-labelledby="map-title">
          <div className="section-heading"><div><p className="eyebrow">TRASA NA DZISIAJ</p><h2 id="map-title">Mapa dnia</h2></div><div className="map-controls"><button type="button" className={`location-control ${position ? "active" : ""}`} onClick={locate} disabled={isLocating} aria-label={`${locationButtonLabel}. Pokaż odległości od aktualnej pozycji.`}><Crosshair size={18} weight="bold" /> {locationButtonLabel}</button><button type="button" className={showToilets ? "active" : ""} aria-pressed={showToilets} onClick={() => setShowToilets((value) => !value)}><Toilet size={18} weight="fill" /> WC</button></div></div>
          <PlannerMap items={mapItems} toilets={TOILETS} completedIds={completedIds} selectedId={selectedId} position={position} showToilets={showToilets} onSelect={(ride) => setSelectedId(ride.id)} />
          {locationStatus === "idle" && <p className="location-message">Włącz GPS, aby zobaczyć w planie metry i orientacyjny czas dojścia od was do każdej atrakcji.</p>}
          {isLocating && <p className="location-message" role="status">Ustalam pozycję telefonu. Gdy ją złapię, odległości pojawią się przy każdej atrakcji.</p>}
          {locationStatus === "ready" && <p className="location-message location-ready" role="status"><Crosshair size={15} weight="fill" /> GPS włączony — odległości w planie są liczone od waszej aktualnej pozycji{locationAccuracy ? ` (dokł. około ±${locationAccuracy} m)` : ""}.</p>}
          {locationStatus === "timeout" && <p className="location-message warning" role="status">Nie udało się szybko ustalić pozycji. Przejdź bliżej otwartej przestrzeni i <button type="button" onClick={locate}>spróbuj GPS ponownie</button>.</p>}
          {locationStatus === "error" && <p className="location-message warning" role="status">Nie udało się odczytać pozycji telefonu. <button type="button" onClick={locate}>Spróbuj GPS ponownie</button>.</p>}
          {locationStatus === "denied" && <p className="location-message warning" role="status">Lokalizacja jest zablokowana. Włącz ją dla tej strony w ustawieniach przeglądarki, aby zobaczyć metry w planie.</p>}
          {locationStatus === "unsupported" && <p className="location-message warning" role="status">Ta przeglądarka nie udostępnia lokalizacji, więc nie pokażemy uczciwych odległości od was.</p>}
          <div className="day-stats"><span><Clock size={16} /> {day.stats.start}–{day.stats.end}</span><span><MapTrifold size={16} /> ~{day.stats.walkingMinutes} min marszu</span><span><CheckCircle size={16} /> {completedToday}/{dayAttractionIds.length}</span></div>
          <p className="queue-snapshot">Kolejki: {queueSnapshot.label}{queueSnapshot.state === "stale" ? " — traktuj jako orientacyjne" : ""}.</p>
        </section>

        <ShowSchedulePanel plan={plan} day={day} selectedDay={selectedDay} schedule={showSchedule} status={showStatus} onRefresh={onRefreshShows} onToggle={onToggleShows} />

        <section className="timeline-section" aria-labelledby="timeline-title">
          <div className="section-heading"><div><p className="eyebrow">PO KOLEI, BEZ CHAOSU</p><h2 id="timeline-title">Plan dnia</h2></div></div>
          <div className="timeline">
            {day.steps.map((step) => {
              if (step.kind === "meal") return <article className="timeline-meal" key={step.id}><span className="timeline-time">{formatPlanTime(step.startMin)}</span><div className="meal-icon"><ForkKnife size={20} weight="fill" /></div><div><em>PRZERWA</em><h3>{step.title}</h3><p>{step.description}</p></div></article>;
              if (step.kind === "show") return <article className="timeline-show" key={step.id}><span className="timeline-time">{formatPlanTime(step.performanceStartMin)}</span><div className="show-icon"><CalendarBlank size={19} weight="fill" /></div><div><em>POKAZ NA ŻYWO • {step.durationMinutes} MIN</em><h3>{step.title}</h3><p>{step.venue} · {step.description}</p><a href={step.officialUrl} target="_blank" rel="noreferrer">Oficjalny opis <CaretRight size={14} /></a></div></article>;
              if (step.kind === "flex") return <article className="timeline-flex" key={step.id}><span className="timeline-time">{formatPlanTime(step.startMin)}</span><div className="flex-icon"><Sparkle size={19} weight="fill" /></div><div><em>ELASTYCZNIE DO {formatPlanTime(step.unplannedUntil ?? step.endMin)}</em><h3>{step.title}</h3><p>{step.description}</p></div></article>;
              if (step.kind === "ride") {
                const ride = ALL_ATTRACTIONS_BY_ID[step.attractionId];
                const completed = completedIds.includes(ride.id);
                const liveDistance = distanceCopy(position, ride);
                return <article className={`timeline-ride ${completed ? "completed" : ""}`} key={step.id}><span className="timeline-time">{formatPlanTime(step.startMin)}</span><button className="ride-content" type="button" onClick={() => setSelectedId(ride.id)}><span className="route-number">{step.sequence}</span><span><em>WSZYSCY • {zoneLabel(ride.zone)}</em><h3>{ride.name}</h3><p>{attractionLabel(ride)}{Number.isFinite(step.queueMinutes) ? ` · kolejka ${step.queueMinutes} min` : ""}</p>{liveDistance && <small className="distance-meta" aria-label={`Odległość od was: ${liveDistance}`}><Footprints size={13} weight="duotone" /> <span>OD WAS</span> · {liveDistance}</small>}</span><CaretRight size={18} /></button><button className="complete-button" type="button" aria-pressed={completed} aria-label={`${completed ? "Cofnij zaliczenie" : "Oznacz jako zaliczoną"}: ${ride.name}`} onClick={() => toggleCompleted(ride.id)}><CheckCircle size={24} weight={completed ? "fill" : "regular"} /></button></article>;
              }
              return <article className="timeline-split" key={step.id}><span className="timeline-time">{formatPlanTime(step.startMin)}</span><div className="split-heading"><span className="route-number">{step.sequence}</span><div><em>PODZIAŁ GRUPY</em><h3>Dwie dobre trasy obok siebie</h3></div></div><div className="split-assignments">{step.assignments.map((assignment, index) => { const ride = ALL_ATTRACTIONS_BY_ID[assignment.attractionId]; const completed = completedIds.includes(ride.id); const liveDistance = distanceCopy(position, ride); return <div className={completed ? "completed" : ""} key={assignment.attractionId}><button className="split-detail" type="button" onClick={() => setSelectedId(ride.id)}><span>{step.sequence}{index === 0 ? "A" : "B"}</span><div><em>{assignment.label}</em><strong>{ride.name}</strong><small>{assignment.memberIds.map((id) => memberLabel(plan.profile.members.find((member) => member.id === id))).join(" · ")}</small>{liveDistance && <small className="distance-meta" aria-label={`Odległość od was: ${liveDistance}`}><Footprints size={13} weight="duotone" /> <span>OD WAS</span> · {liveDistance}</small>}</div><CaretRight size={17} /></button><button className="split-complete" type="button" aria-pressed={completed} aria-label={`${completed ? "Cofnij zaliczenie" : "Oznacz jako zaliczoną"}: ${ride.name}`} onClick={() => toggleCompleted(ride.id)}><CheckCircle size={22} weight={completed ? "fill" : "regular"} /></button></div>; })}</div><p className="reunion"><MapPin size={16} weight="fill" /><span><strong>{step.reunion.time}</strong> · {step.reunion.label}</span></p></article>;
            })}
          </div>
        </section>

        <section className="export-section" aria-labelledby="export-title">
          <p className="eyebrow">ZABIERZ PLAN ZE SOBĄ</p><h2 id="export-title">Jeden plan dla całej grupy</h2><p>W krótkim linku nie ma imion ani bieżącej lokalizacji. Anonimowy plan z rolą, wiekiem i wzrostem jest przechowywany maksymalnie 90 dni, żeby dało się go otworzyć w komunikatorze. Stan „zaliczone” zostaje tylko na tym telefonie.</p>
          <div className="export-actions"><button type="button" onClick={share} disabled={shortLinkStatus === "loading"}><ShareNetwork size={21} weight="bold" /> {shortLinkStatus === "loading" ? "Tworzę link…" : "Udostępnij plan"}</button><button type="button" onClick={copy} disabled={shortLinkStatus === "loading"}><Copy size={21} weight="bold" /> {shortLinkStatus === "loading" ? "Tworzę link…" : "Kopiuj link"}</button><button type="button" onClick={() => setShowPdfPreview(true)}><Printer size={21} weight="bold" /> Przygotuj piękny PDF</button></div>
          {shortLinkStatus === "loading" && <p className="data-status" role="status"><span />Tworzę krótki, klikalny link do tego planu…</p>}
          {shortLinkStatus === "ready" && <p className="data-status" role="status"><span className="ready" />Krótki link jest gotowy — działa w WhatsAppie i Signalu.</p>}
          {shortLinkStatus === "error" && <div className="warning-note" role="alert"><WarningCircle size={21} weight="fill" /><span><strong>Krótki link nie powstał.</strong> {shortLinkError} <button type="button" onClick={copy}>Spróbuj ponownie</button> albo <button type="button" onClick={copyLocalFallback}>skopiuj lokalny, długi link</button>.</span></div>}
          <form className="email-box" onSubmit={openEmail}><label><span>Adres e-mail</span><input type="email" required placeholder="np. rodzina@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label><button type="submit"><EnvelopeSimple size={20} weight="bold" /> Otwórz szkic e-maila</button><small>Nie wysyłamy ani nie zapisujemy adresu. Szkic pocztowy zawiera pełną rozpiskę i wpisane nazwy uczestników; PDF możesz zapisać powyżej i dołączyć samodzielnie.</small></form>
          {shortPlanUrl
            ? <input ref={shareUrlRef} className="share-url" readOnly value={shortPlanUrl} aria-label="Krótki link do planu" />
            : showLocalFallback
              ? <input ref={shareUrlRef} className="share-url" readOnly value={compactPlanUrl} aria-label="Lokalny, długi link do planu" />
              : shortLinkStatus === "idle" && <p className="data-status"><span />Kliknij „Kopiuj link”, aby stworzyć krótki adres do komunikatora.</p>}
        </section>
        <footer className="app-footer">Plan jest pomocą, nie regulaminem. Ograniczenia przy wejściu, pomiar i polecenia obsługi Energylandii zawsze mają pierwszeństwo. Źródła: oficjalne strony atrakcji i pokazów, OpenStreetMap oraz Queue-Times.</footer>
        {notice && <div className="toast" role="status">{notice}</div>}
      </main>
      {showPdfPreview && <PdfPreview plan={plan} planUrl={planUrl} onClose={() => setShowPdfPreview(false)} />}
      {selectedAttraction && <DetailSheet attraction={selectedAttraction} sequence={selectedAssignment.sequence} memberIds={selectedAssignment.memberIds} members={plan.profile.members} onClose={closeDetail} />}
    </>
  );
}

export function App() {
  const initialHash = useMemo(() => window.location.hash, []);
  const shortPlanToken = useMemo(() => shortPlanTokenFromHash(initialHash), [initialHash]);
  const shortHashPresent = useMemo(() => hasShortPlanHash(initialHash), [initialHash]);
  const sharedHashPresent = useMemo(() => /(?:^|[#&])plan=/.test(initialHash) || shortHashPresent, [initialHash, shortHashPresent]);
  const legacySharedPlan = useMemo(() => {
    try { return planFromHash(); } catch { return null; }
  }, []);
  const storedPlan = useMemo(() => safeSanitizePlan(readStored(PLAN_KEY, null)), []);
  const [screen, setScreen] = useState(legacySharedPlan || shortHashPresent ? "plan" : "entry");
  const [welcomeBackScreen, setWelcomeBackScreen] = useState("entry");
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState(() => normalizeDraftProfile(readStored(DRAFT_KEY, DEFAULT_PROFILE), DEFAULT_PROFILE));
  const [plan, setPlan] = useState(legacySharedPlan);
  const [shortPlanLoadStatus, setShortPlanLoadStatus] = useState(() => shortHashPresent ? (shortPlanToken ? "loading" : "error") : "idle");
  const [shortPlanLoadError, setShortPlanLoadError] = useState(() => shortHashPresent && !shortPlanToken ? "Ten krótki link wygląda na niepełny." : "");
  const [shortPlanLoadAttempt, setShortPlanLoadAttempt] = useState(0);
  const [shortLinkDismissed, setShortLinkDismissed] = useState(false);
  const [queues, setQueues] = useState(null);
  const [queueStatus, setQueueStatus] = useState("loading");
  const [showSchedule, setShowSchedule] = useState(null);
  const [showStatus, setShowStatus] = useState("loading");
  const [generationError, setGenerationError] = useState("");
  const [weather, setWeather] = useState(null);
  const [weatherStatus, setWeatherStatus] = useState("loading");
  const [weatherClock, setWeatherClock] = useState(() => Date.now());
  const queuesRef = useRef(null);
  const showScheduleRef = useRef(null);
  const weatherRef = useRef(null);

  useEffect(() => writeStored(DRAFT_KEY, profile), [profile]);
  useEffect(() => {
    if (!shortHashPresent || !shortPlanToken || shortLinkDismissed) return undefined;
    let cancelled = false;
    setShortPlanLoadStatus("loading");
    setShortPlanLoadError("");
    loadShortPlan(shortPlanToken)
      .then((loadedPlan) => {
        if (cancelled) return;
        setPlan(loadedPlan);
        writeStored(PLAN_KEY, loadedPlan);
        setShortPlanLoadStatus("ready");
        setScreen("plan");
        window.scrollTo({ top: 0, behavior: "auto" });
      })
      .catch((error) => {
        if (cancelled) return;
        setShortPlanLoadStatus("error");
        setShortPlanLoadError(error instanceof Error ? error.message : "Nie udało się pobrać krótkiego planu.");
      });
    return () => { cancelled = true; };
  }, [shortHashPresent, shortLinkDismissed, shortPlanLoadAttempt, shortPlanToken]);
  const refreshQueues = useCallback(async (signal) => {
    setQueueStatus("loading");
    try {
      const data = await loadQueueTimes(signal);
      queuesRef.current = data;
      setQueues(data);
      setQueueStatus("ready");
      return data;
    } catch (error) {
      if (error?.name !== "AbortError") setQueueStatus(queuesRef.current ? "stale" : "error");
      return null;
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    refreshQueues(controller.signal);
    return () => controller.abort();
  }, [refreshQueues]);

  const refreshShows = useCallback(async (signal) => {
    setShowStatus("loading");
    try {
      const data = await loadShowSchedule(signal);
      showScheduleRef.current = data;
      setShowSchedule(data);
      setShowStatus("ready");
      return data;
    } catch (error) {
      if (error?.name !== "AbortError") setShowStatus(showScheduleRef.current ? "stale" : "error");
      return null;
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    refreshShows(controller.signal);
    return () => controller.abort();
  }, [refreshShows]);

  const refreshWeather = useCallback(async () => {
    setWeatherStatus(weatherRef.current ? "refreshing" : "loading");
    try {
      const nextWeather = await loadWeather();
      weatherRef.current = nextWeather;
      setWeather(nextWeather);
      setWeatherClock(Date.now());
      setWeatherStatus("ready");
      return nextWeather;
    } catch {
      setWeatherStatus(weatherRef.current ? "stale" : "error");
      return null;
    }
  }, []);

  const refreshAntistorm = useCallback(async () => {
    if (!weatherRef.current) return null;
    try {
      const antistorm = await loadAntistormNowcast();
      const nextWeather = {
        ...weatherRef.current,
        antistorm,
        sources: (weatherRef.current.sources || []).map((source) => source.name === "Antistorm" ? {
          ...source,
          status: "ok",
          detail: `Nowcast co 15 min • ${antistorm.m || "najbliższy punkt"}`,
          updatedAt: antistorm.updatedAt,
        } : source),
      };
      weatherRef.current = nextWeather;
      setWeather(nextWeather);
      setWeatherClock(Date.now());
      return antistorm;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    refreshWeather();
    const fullForecastInterval = window.setInterval(refreshWeather, 15 * 60_000);
    const nowcastInterval = window.setInterval(refreshAntistorm, 5 * 60_000);
    const clockInterval = window.setInterval(() => setWeatherClock(Date.now()), 60_000);
    return () => {
      window.clearInterval(fullForecastInterval);
      window.clearInterval(nowcastInterval);
      window.clearInterval(clockInterval);
    };
  }, [refreshAntistorm, refreshWeather]);

  const weatherAssessment = useMemo(() => weather ? assessThreeDayWeather(weather, { now: new Date(weatherClock), carWalkMinutes: 30 }) : null, [weather, weatherClock]);
  const queueMapFor = useCallback((queueData) => Object.fromEntries(Object.values(ALL_ATTRACTIONS_BY_ID).map((attraction) => [attraction.id, queueForAttraction(attraction, queueData)])), []);
  const buildPlanForProfile = useCallback((profileInput, queueData, scheduleData = showScheduleRef.current) => {
    const normalizedProfile = normalizeDraftProfile(profileInput, DEFAULT_PROFILE);
    const safeProfile = normalizedProfile.members.filter(isGuardian).length < 2 ? { ...normalizedProfile, splitPolicy: "never" } : normalizedProfile;
    const basePlan = buildUniversalPlan({ ...safeProfile, queueSnapshotAt: queueData?.updatedAt ?? null }, { queueById: queueMapFor(queueData) });
    return overlayShowsOnPlan(basePlan, scheduleData);
  }, [queueMapFor]);

  const generate = useCallback(() => {
    setGenerationError("");
    const nextPlan = buildPlanForProfile(profile, queues);
    if (countPlanAttractions(nextPlan) === 0) {
      setGenerationError("Podnieś limit kolejki, poluzuj tryb „spokojnie” lub sprawdź wzrost i wiek uczestników. Nie udostępnimy pustego linku udającego plan.");
      setStep(STEP_LABELS.length - 1);
      setScreen("onboarding");
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    setPlan(nextPlan);
    writeStored(PLAN_KEY, nextPlan);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setScreen("plan");
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [buildPlanForProfile, profile, queues]);

  const prepareFreshPlan = ({ dayCount = 1, startDate = null } = {}, backScreen = "entry") => {
    const freshProfile = normalizeDraftProfile({ ...DEFAULT_PROFILE, dayCount, visitStartDate: startDate || DEFAULT_PROFILE.visitStartDate }, DEFAULT_PROFILE);
    setGenerationError("");
    setProfile(freshProfile);
    setStep(0);
    setWelcomeBackScreen(backScreen);
    setScreen("welcome");
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const beginOnboarding = () => {
    setStep(0);
    setScreen("onboarding");
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const reanalyze = async () => {
    if (!plan) return;
    const latestQueues = await refreshQueues();
    const nextPlan = buildPlanForProfile(plan.profile, latestQueues || queues);
    if (countPlanAttractions(nextPlan) === 0) return;
    setPlan(nextPlan);
    writeStored(PLAN_KEY, nextPlan);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const refreshShowsAndReanalyze = useCallback(async () => {
    const latestShows = await refreshShows();
    if (!plan) return latestShows;
    const nextPlan = buildPlanForProfile(plan.profile, queues, latestShows || showScheduleRef.current);
    if (countPlanAttractions(nextPlan) === 0) return latestShows;
    setPlan(nextPlan);
    writeStored(PLAN_KEY, nextPlan);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    return latestShows;
  }, [buildPlanForProfile, plan, queues, refreshShows]);

  const toggleShowsInPlan = useCallback((includeShows) => {
    const sourceProfile = plan?.profile || profile;
    const nextProfile = normalizeDraftProfile({
      ...sourceProfile,
      entertainment: { ...(sourceProfile.entertainment || {}), includeShows },
    }, DEFAULT_PROFILE);
    setProfile(nextProfile);
    if (!plan) return;
    const nextPlan = buildPlanForProfile(nextProfile, queues, showScheduleRef.current);
    if (countPlanAttractions(nextPlan) === 0) return;
    setPlan(nextPlan);
    writeStored(PLAN_KEY, nextPlan);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }, [buildPlanForProfile, plan, profile, queues]);

  const leaveSharedShortLink = () => {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setShortLinkDismissed(true);
    setScreen("entry");
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const retrySharedShortLink = () => {
    if (!shortPlanToken) {
      setShortPlanLoadStatus("error");
      setShortPlanLoadError("Ten krótki link wygląda na niepełny.");
      return;
    }
    setShortPlanLoadAttempt((attempt) => attempt + 1);
  };

  if (shortHashPresent && !shortLinkDismissed && (shortPlanLoadStatus !== "ready" || !plan)) {
    return <SharedPlanStatus status={shortPlanLoadStatus} error={shortPlanLoadError} onRetry={retrySharedShortLink} onStart={leaveSharedShortLink} />;
  }

  if (screen === "entry") {
    return <EntryStart onWeather={() => setScreen("weather")} onPlan={() => prepareFreshPlan({}, "entry")} onResume={storedPlan ? () => { setPlan(storedPlan); setScreen("plan"); } : null} />;
  }

  if (screen === "weather") {
    return <WeatherStart weather={weather} assessment={weatherAssessment} status={weatherStatus} onRefresh={refreshWeather} damagedLink={sharedHashPresent && !plan} onBack={() => setScreen("entry")} onContinue={(selection) => prepareFreshPlan(selection, "weather")} onResume={storedPlan ? () => { setPlan(storedPlan); setScreen("plan"); } : null} />;
  }

  if (screen === "welcome") return <Welcome onStart={beginOnboarding} onBack={() => setScreen(welcomeBackScreen)} backLabel={welcomeBackScreen === "weather" ? "Wróć do pogody" : "Wróć do początku"} onResume={storedPlan ? () => { setPlan(storedPlan); setScreen("plan"); } : null} />;

  if (screen === "onboarding") return <Onboarding profile={profile} setProfile={setProfile} step={step} setStep={setStep} onGenerate={generate} queueStatus={queueStatus} queueUpdatedAt={queues?.updatedAt ?? null} onRefreshQueues={() => refreshQueues()} generationError={generationError} weatherAssessment={weatherAssessment} />;
  if (!plan) return null;
  return <PlanView plan={plan} initialShortPlanUrl={shortHashPresent && !shortLinkDismissed ? createShortPlanUrl(shortPlanToken) : ""} onReanalyze={reanalyze} weatherAssessment={weatherAssessment} weatherStatus={weatherStatus} onRefreshWeather={refreshWeather} showSchedule={showSchedule} showStatus={showStatus} onRefreshShows={refreshShowsAndReanalyze} onToggleShows={toggleShowsInPlan} onEdit={() => { setGenerationError(""); setProfile(normalizeDraftProfile(plan.profile, DEFAULT_PROFILE)); setStep(0); setScreen("onboarding"); }} />;
}
