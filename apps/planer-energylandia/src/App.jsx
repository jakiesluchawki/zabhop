import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AppleLogo,
  ArrowLeft,
  ArrowRight,
  ArrowsSplit,
  CalendarBlank,
  CaretRight,
  CheckCircle,
  Clock,
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
import {
  createEmailDraftUrl,
  createPlanUrl,
  planFromHash,
  sanitizeSharedPlan,
} from "./share.js";
import {
  approximateWalkingMinutes,
  countPlanAttractions,
  distanceMeters,
  formatDistance,
  normalizeDraftProfile,
  queueFreshness,
} from "./appUtils.js";

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
  arrivalTime: "10:00",
  departureTime: "20:00",
  pace: "normal",
  splitPolicy: "worthwhile",
  members: [
    { id: "adult-1", role: "adult", name: "Dorosły 1", age: 35, height: 175 },
    { id: "adult-2", role: "adult", name: "Dorosły 2", age: 35, height: 175 },
    { id: "child-1", role: "child", name: "Dziecko 1", age: 6, height: 120 },
    { id: "child-2", role: "child", name: "Dziecko 2", age: 6, height: 120 },
  ],
  preferences: {
    intensity: "mixed",
    interests: ["coasters", "family"],
    wet: "ok",
    maxQueue: 30,
  },
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
    ? { id: `adult-${index + 1}`, role, name: `Dorosły ${index + 1}`, age: 35, height: 175 }
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

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setPosition(null);
      setStatus("unsupported");
      return;
    }
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    setPosition(null);
    setStatus("loading");
    watchRef.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        setPosition({ lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy });
        setStatus("ready");
      },
      (error) => {
        setPosition(null);
        if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
        setStatus(error?.code === 1 ? "denied" : "error");
      },
      { enableHighAccuracy: true, maximumAge: 8_000, timeout: 15_000 },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    let permission = null;
    const syncPermission = () => {
      if (cancelled || !permission) return;
      if (permission.state === "granted") {
        if (watchRef.current == null) locate();
      } else if (permission.state === "denied") {
        if (watchRef.current != null) navigator.geolocation?.clearWatch(watchRef.current);
        watchRef.current = null;
        setPosition(null);
        setStatus("denied");
      } else {
        setPosition(null);
        setStatus("idle");
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
      if (watchRef.current != null) navigator.geolocation?.clearWatch(watchRef.current);
    };
  }, [locate]);

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

function Onboarding({ profile, setProfile, step, setStep, onGenerate, queueStatus, queueUpdatedAt, onRefreshQueues, generationError }) {
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
            <div className="day-choice-grid">
              {[1, 2, 3].map((days) => (
                <button key={days} className={profile.dayCount === days ? "selected" : ""} type="button" aria-pressed={profile.dayCount === days} onClick={() => setProfile((current) => ({ ...current, dayCount: days }))}>
                  <CalendarBlank size={25} weight={profile.dayCount === days ? "fill" : "duotone"} />
                  <strong>{days}</strong><span>{days === 1 ? "dzień" : "dni"}</span>
                </button>
              ))}
            </div>
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
            <p className="step-lead">Nie zgaduj w górę. Obsługa i pomiar przy wejściu zawsze mają ostatnie słowo.</p>
            <WizardIllustration step={step} />
            <div className="member-stack">
              {profile.members.map((member, index) => (
                <article className={`member-card ${member.role}`} key={member.id} role="group" aria-labelledby={`member-title-${member.id}`}>
                  <div className="member-card-title"><span>{index + 1}</span><strong id={`member-title-${member.id}`}>{member.role === "adult" ? "Dorosły" : "Dziecko / nastolatek"}</strong></div>
                  <label className="wide-field"><span>Imię lub skrót — opcjonalnie</span><input type="text" maxLength="40" aria-label={`${memberLabel(member)}: imię lub skrót`} value={member.name} onChange={(event) => updateMember(member.id, "name", event.target.value)} /></label>
                  <div className="number-field-grid">
                    <label><span>Wiek</span><div><input inputMode="numeric" type="number" min="0" max="110" aria-label={`${memberLabel(member)}: wiek`} aria-invalid={member.role === "adult" ? Number(member.age) < 18 || Number(member.age) > 110 : Number(member.age) < 0 || Number(member.age) > 17} aria-describedby={!agesValid ? "age-validation-error" : undefined} value={member.age} onChange={(event) => updateMember(member.id, "age", Number(event.target.value))} /><em>lat</em></div></label>
                    <label><span>Wzrost</span><div><input inputMode="numeric" type="number" min="50" max="230" aria-label={`${memberLabel(member)}: wzrost`} aria-invalid={Number(member.height) < 50 || Number(member.height) > 230} aria-describedby={!heightsValid ? "height-validation-error" : undefined} value={member.height} onChange={(event) => updateMember(member.id, "height", Number(event.target.value))} /><em>cm</em></div></label>
                  </div>
                </article>
              ))}
            </div>
            {!agesValid && <div className="warning-note" id="age-validation-error" role="alert"><WarningCircle size={21} weight="fill" /><span>Dorośli opiekunowie muszą mieć co najmniej 18 lat; w tej sekcji dzieci i nastolatki mają 0–17 lat.</span></div>}
            {!heightsValid && <div className="warning-note" id="height-validation-error" role="alert"><WarningCircle size={21} weight="fill" /><span>Podaj rzeczywisty wzrost każdej osoby w zakresie 50–230 cm.</span></div>}
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
              <div><CalendarBlank size={22} weight="duotone" /><span><strong>{profile.dayCount} {profile.dayCount === 1 ? "dzień" : "dni"}</strong><small>{profile.arrivalTime}–{profile.departureTime} · tempo {profile.pace === "easy" ? "spokojne" : profile.pace === "fast" ? "szybkie" : "normalne"}</small></span></div>
              <div><UsersThree size={22} weight="duotone" /><span><strong>{profile.members.length} osób</strong><small>{profile.members.map((member) => `${memberLabel(member)} ${member.height} cm`).join(" · ")}</small></span></div>
              <div><Sparkle size={22} weight="duotone" /><span><strong>{profile.preferences.intensity === "thrill" ? "Mocny dzień" : profile.preferences.intensity === "calm" ? "Spokojny dzień" : "Po trochu"}</strong><small>kolejki do {profile.preferences.maxQueue} min · woda: {profile.preferences.wet === "avoid" ? "nie" : profile.preferences.wet === "want" ? "tak" : "może być"}</small></span></div>
              <div><ArrowsSplit size={22} weight="duotone" /><span><strong>{effectiveSplitPolicy === "never" ? "Zawsze razem" : effectiveSplitPolicy === "often" ? "Podział dozwolony" : "Jeden wartościowy podział"}</strong><small>{profile.meal.mode === "none" ? "bez zaplanowanego obiadu" : `obiad około ${profile.meal.time}`}</small></span></div>
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
      if (step.kind === "meal" || step.kind === "flex") return step;
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

function PrintablePlan({ plan, planUrl }) {
  if (!plan) return null;
  return (
    <article className="print-plan">
      <header><p>PLAN DLA WAS • ENERGYLANDIA</p><h1>{plan.days.length} {plan.days.length === 1 ? "dzień" : "dni"} bez biegania w kółko</h1><span>Wygenerowano {new Date(plan.generatedAt).toLocaleString("pl-PL")}</span></header>
      <section className="print-party"><h2>Skład</h2><p>{plan.profile.members.map((member) => `${memberLabel(member)} — ${member.age} lat, ${member.height} cm`).join(" • ")}</p></section>
      {plan.days.map((rawDay) => {
        const day = annotatedDay(rawDay);
        return <section className="print-day" key={day.day}><h2>{day.label} <small>{day.stats.start}–{day.stats.end}</small></h2>{day.steps.map((step) => {
          if (step.kind === "meal") return <div className="print-step meal" key={step.id}><strong>{formatPlanTime(step.startMin)} · OBIAD</strong><span>{step.title}</span><small>{step.description}</small></div>;
          if (step.kind === "flex") return <div className="print-step flex" key={step.id}><strong>{formatPlanTime(step.startMin)}–{formatPlanTime(step.endMin)} · BUFOR</strong><span>{step.title}</span><small>{step.description}</small></div>;
          if (step.kind === "ride") { const ride = ALL_ATTRACTIONS_BY_ID[step.attractionId]; return <div className="print-step" key={step.id}><strong>{formatPlanTime(step.startMin)} · {step.sequence}</strong><span>{ride.name}</span><small>{zoneLabel(ride.zone)} · {attractionLabel(ride)} · wszyscy</small></div>; }
          return <div className="print-step split" key={step.id}><strong>{formatPlanTime(step.startMin)} · {step.sequence} · PODZIAŁ</strong>{step.assignments.map((assignment) => { const ride = ALL_ATTRACTIONS_BY_ID[assignment.attractionId]; return <span key={assignment.attractionId}>{assignment.label}: <b>{ride.name}</b> — {assignment.memberIds.map((id) => memberLabel(plan.profile.members.find((member) => member.id === id))).join(", ")}</span>; })}<small>Spotkanie {step.reunion.time}: {step.reunion.label}</small></div>;
        })}</section>;
      })}
      <footer><p><a href={planUrl}>Otwórz żywy plan w aplikacji</a> — pełny adres jest zapisany w tym hiperłączu.</p><p>Ten wydruk zawiera wpisane imiona, wiek i wzrost uczestników. Udostępniaj go świadomie.</p><p>Ograniczenia przy wejściu i decyzje obsługi parku mają pierwszeństwo. Kolejki są migawką z momentu planowania.</p></footer>
    </article>
  );
}

function PlanView({ plan, onEdit }) {
  const [selectedDay, setSelectedDay] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [showToilets, setShowToilets] = useState(false);
  const { position, status: locationStatus, locate } = useUserLocation();
  const completedKey = useMemo(() => `${COMPLETED_KEY}:${String(plan.generatedAt || "plan").slice(0, 40)}`, [plan.generatedAt]);
  const [completedIds, setCompletedIds] = useState(() => {
    const stored = readStored(completedKey, []);
    return Array.isArray(stored) ? [...new Set(stored.filter((id) => ALL_ATTRACTIONS_BY_ID[id]))] : [];
  });
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const shareUrlRef = useRef(null);
  const day = annotatedDay(plan.days[selectedDay] ?? plan.days[0] ?? { steps: [], stats: {} });
  const mapItems = planMapItems(day);
  const planUrl = useMemo(() => createPlanUrl(plan), [plan]);
  const dayAttractionIds = day.steps.flatMap((step) => {
    if (step.kind === "ride") return [step.attractionId];
    if (step.kind === "split") return step.assignments.map((assignment) => assignment.attractionId);
    return [];
  });
  const nextAttractionId = dayAttractionIds.find((id) => !completedIds.includes(id));
  const firstRide = ALL_ATTRACTIONS_BY_ID[nextAttractionId];
  const firstRideDistance = firstRide ? distanceCopy(position, firstRide) : null;
  const completedToday = dayAttractionIds.filter((id) => completedIds.includes(id)).length;
  const queueSnapshot = queueFreshness(plan.queueSnapshotAt);
  const selectedAttraction = selectedId ? ALL_ATTRACTIONS_BY_ID[selectedId] : null;
  const selectedMapItem = mapItems.find((item) => item.id === selectedId);
  const selectedAssignment = day.steps.flatMap((step) => {
    if (step.kind === "ride" && step.attractionId === selectedId) return [{ memberIds: step.memberIds, sequence: step.sequence }];
    if (step.kind === "split") return step.assignments.flatMap((assignment, index) => assignment.attractionId === selectedId ? [{ memberIds: assignment.memberIds, sequence: `${step.sequence}${index === 0 ? "A" : "B"}` }] : []);
    return [];
  })[0] ?? { memberIds: plan.profile.members.map((member) => member.id), sequence: selectedMapItem?.sequence ?? "" };

  useEffect(() => writeStored(completedKey, completedIds), [completedIds, completedKey]);
  useEffect(() => { if (notice) { const timeout = window.setTimeout(() => setNotice(""), 2400); return () => window.clearTimeout(timeout); } return undefined; }, [notice]);
  useEffect(() => setSelectedId(null), [selectedDay]);

  const toggleCompleted = (id) => {
    const attraction = ALL_ATTRACTIONS_BY_ID[id];
    const wasCompleted = completedIds.includes(id);
    setCompletedIds((current) => wasCompleted ? current.filter((item) => item !== id) : [...current, id]);
    setNotice(wasCompleted ? `Przywrócono: ${attraction?.name ?? "atrakcja"}` : `Zaliczone: ${attraction?.name ?? "atrakcja"}`);
  };
  const closeDetail = useCallback(() => setSelectedId(null), []);
  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: "Nasz plan Energylandii", text: "Spersonalizowana trasa dla naszej grupy", url: planUrl });
        return;
      }
      await navigator.clipboard.writeText(planUrl);
      setNotice("Link skopiowany");
    } catch (error) {
      if (error?.name !== "AbortError") setNotice("Nie udało się otworzyć udostępniania");
    }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(planUrl); setNotice("Link skopiowany"); } catch {
      shareUrlRef.current?.focus();
      shareUrlRef.current?.select();
      setNotice("Link zaznaczony — wybierz Kopiuj");
    }
  };
  const openEmail = (event) => {
    event.preventDefault();
    if (!email || !event.currentTarget.reportValidity()) return;
    window.location.href = createEmailDraftUrl(email, planUrl, plan);
  };

  return (
    <>
      <main className="plan-shell screen-app">
        <header className="plan-topbar"><div><p className="eyebrow">PLAN DLA WAS</p><h1>Wasza Energylandia</h1></div><button type="button" onClick={onEdit}><PencilSimple size={17} /> Zmień</button></header>
        {!plan.safety?.valid && <div className="safety-alert"><WarningCircle size={22} weight="fill" /><span><strong>Plan wymaga poprawy</strong><small>{plan.safety?.issues?.[0]}</small></span></div>}
        <section className="plan-hero" aria-live="polite">
          <p>DZIEŃ {day.day ?? selectedDay + 1} Z {plan.days.length} • {plan.profile.members.length} OSÓB</p>
          <h2>{firstRide ? <>{completedToday > 0 ? "Teraz czas na" : "Zacznijcie od"}<br /><em>{firstRide.name}</em></> : `Dzień ${day.day ?? selectedDay + 1} zaliczony`}</h2>
          <span>{firstRide ? "Najpierw bezpieczeństwo, potem zgodność z waszym apetytem, kolejki i logiczny marsz." : "Wszystkie atrakcje zaplanowane na ten dzień są już oznaczone jako zaliczone."}</span>
          {firstRideDistance && <small className="hero-distance"><Footprints size={16} weight="duotone" /> {firstRideDistance}</small>}
          {firstRide && <button className="hero-next-button" type="button" aria-haspopup="dialog" onClick={() => setSelectedId(firstRide.id)}>Opis i prowadzenie <CaretRight size={18} /></button>}
        </section>
        <nav className="day-tabs" aria-label="Dni planu">{plan.days.map((item, index) => <button key={item.day} type="button" className={selectedDay === index ? "selected" : ""} aria-pressed={selectedDay === index} aria-current={selectedDay === index ? "step" : undefined} onClick={() => { setSelectedDay(index); setNotice(`Pokazuję dzień ${item.day}`); }}>Dzień {item.day}<small>{item.stats.attractions} atrakcji</small></button>)}</nav>

        <section className="plan-map-card" aria-labelledby="map-title">
          <div className="section-heading"><div><p className="eyebrow">TRASA NA DZISIAJ</p><h2 id="map-title">Mapa dnia</h2></div><div className="map-controls"><button type="button" className={`location-control ${locationStatus === "ready" ? "active" : ""}`} onClick={locate}><Crosshair size={18} weight="bold" /> {locationStatus === "loading" ? "Szukam…" : locationStatus === "ready" ? "GPS" : "Odległości"}</button><button type="button" className={showToilets ? "active" : ""} aria-pressed={showToilets} onClick={() => setShowToilets((value) => !value)}><Toilet size={18} weight="fill" /> WC</button></div></div>
          <PlannerMap items={mapItems} toilets={TOILETS} completedIds={completedIds} selectedId={selectedId} position={position} showToilets={showToilets} onSelect={(ride) => setSelectedId(ride.id)} />
          {locationStatus === "idle" && <p className="location-message">Włącz „Odległości”, aby zobaczyć metry i orientacyjny czas dojścia przy każdej atrakcji.</p>}
          {(locationStatus === "denied" || locationStatus === "error" || locationStatus === "unsupported") && <p className="location-message warning" role="status">Nie mam dostępu do pozycji telefonu. Włącz lokalizację dla tej strony w ustawieniach przeglądarki.</p>}
          <div className="day-stats"><span><Clock size={16} /> {day.stats.start}–{day.stats.end}</span><span><MapTrifold size={16} /> ~{day.stats.walkingMinutes} min marszu</span><span><CheckCircle size={16} /> {completedToday}/{dayAttractionIds.length}</span></div>
          <p className="queue-snapshot">Kolejki: {queueSnapshot.label}{queueSnapshot.state === "stale" ? " — traktuj jako orientacyjne" : ""}.</p>
        </section>

        <section className="timeline-section" aria-labelledby="timeline-title">
          <div className="section-heading"><div><p className="eyebrow">PO KOLEI, BEZ CHAOSU</p><h2 id="timeline-title">Plan dnia</h2></div></div>
          <div className="timeline">
            {day.steps.map((step) => {
              if (step.kind === "meal") return <article className="timeline-meal" key={step.id}><span className="timeline-time">{formatPlanTime(step.startMin)}</span><div className="meal-icon"><ForkKnife size={20} weight="fill" /></div><div><em>PRZERWA</em><h3>{step.title}</h3><p>{step.description}</p></div></article>;
              if (step.kind === "flex") return <article className="timeline-flex" key={step.id}><span className="timeline-time">{formatPlanTime(step.startMin)}</span><div className="flex-icon"><Sparkle size={19} weight="fill" /></div><div><em>ELASTYCZNIE DO {formatPlanTime(step.endMin)}</em><h3>{step.title}</h3><p>{step.description}</p></div></article>;
              if (step.kind === "ride") {
                const ride = ALL_ATTRACTIONS_BY_ID[step.attractionId];
                const completed = completedIds.includes(ride.id);
                const liveDistance = distanceCopy(position, ride);
                return <article className={`timeline-ride ${completed ? "completed" : ""}`} key={step.id}><span className="timeline-time">{formatPlanTime(step.startMin)}</span><button className="ride-content" type="button" onClick={() => setSelectedId(ride.id)}><span className="route-number">{step.sequence}</span><span><em>WSZYSCY • {zoneLabel(ride.zone)}</em><h3>{ride.name}</h3><p>{attractionLabel(ride)}{Number.isFinite(step.queueMinutes) ? ` · kolejka ${step.queueMinutes} min` : ""}</p>{liveDistance && <small className="distance-meta"><Footprints size={13} weight="duotone" /> {liveDistance}</small>}</span><CaretRight size={18} /></button><button className="complete-button" type="button" aria-pressed={completed} aria-label={`${completed ? "Cofnij zaliczenie" : "Oznacz jako zaliczoną"}: ${ride.name}`} onClick={() => toggleCompleted(ride.id)}><CheckCircle size={24} weight={completed ? "fill" : "regular"} /></button></article>;
              }
              return <article className="timeline-split" key={step.id}><span className="timeline-time">{formatPlanTime(step.startMin)}</span><div className="split-heading"><span className="route-number">{step.sequence}</span><div><em>PODZIAŁ GRUPY</em><h3>Dwie dobre trasy obok siebie</h3></div></div><div className="split-assignments">{step.assignments.map((assignment, index) => { const ride = ALL_ATTRACTIONS_BY_ID[assignment.attractionId]; const completed = completedIds.includes(ride.id); const liveDistance = distanceCopy(position, ride); return <div className={completed ? "completed" : ""} key={assignment.attractionId}><button className="split-detail" type="button" onClick={() => setSelectedId(ride.id)}><span>{step.sequence}{index === 0 ? "A" : "B"}</span><div><em>{assignment.label}</em><strong>{ride.name}</strong><small>{assignment.memberIds.map((id) => memberLabel(plan.profile.members.find((member) => member.id === id))).join(" · ")}</small>{liveDistance && <small className="distance-meta"><Footprints size={13} weight="duotone" /> {liveDistance}</small>}</div><CaretRight size={17} /></button><button className="split-complete" type="button" aria-pressed={completed} aria-label={`${completed ? "Cofnij zaliczenie" : "Oznacz jako zaliczoną"}: ${ride.name}`} onClick={() => toggleCompleted(ride.id)}><CheckCircle size={22} weight={completed ? "fill" : "regular"} /></button></div>; })}</div><p className="reunion"><MapPin size={16} weight="fill" /><span><strong>{step.reunion.time}</strong> · {step.reunion.label}</span></p></article>;
            })}
          </div>
        </section>

        <section className="export-section" aria-labelledby="export-title">
          <p className="eyebrow">ZABIERZ PLAN ZE SOBĄ</p><h2 id="export-title">Jeden plan dla całej grupy</h2><p>Link nie zawiera imion ani bieżącej lokalizacji, ale zachowuje wiek, wzrost i role potrzebne do sprawdzenia bezpieczeństwa. Stan „zaliczone” zostaje tylko na tym telefonie.</p>
          <div className="export-actions"><button type="button" onClick={share}><ShareNetwork size={21} weight="bold" /> Udostępnij plan</button><button type="button" onClick={copy}><Copy size={21} weight="bold" /> Kopiuj link</button><button type="button" onClick={() => window.print()}><Printer size={21} weight="bold" /> Drukuj / zapisz PDF</button></div>
          <form className="email-box" onSubmit={openEmail}><label><span>Adres e-mail</span><input type="email" required placeholder="np. rodzina@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label><button type="submit"><EnvelopeSimple size={20} weight="bold" /> Otwórz szkic e-maila</button><small>Nie wysyłamy ani nie zapisujemy adresu. Szkic pocztowy zawiera pełną rozpiskę i wpisane nazwy uczestników; PDF możesz zapisać powyżej i dołączyć samodzielnie.</small></form>
          <input ref={shareUrlRef} className="share-url" readOnly value={planUrl} aria-label="Link do planu" />
        </section>
        <footer className="app-footer">Plan jest pomocą, nie regulaminem. Ograniczenia przy wejściu, pomiar i polecenia obsługi Energylandii zawsze mają pierwszeństwo. Źródła: oficjalne strony atrakcji, OpenStreetMap i Queue-Times.</footer>
        {notice && <div className="toast" role="status">{notice}</div>}
      </main>
      <PrintablePlan plan={plan} planUrl={planUrl} />
      {selectedAttraction && <DetailSheet attraction={selectedAttraction} sequence={selectedAssignment.sequence} memberIds={selectedAssignment.memberIds} members={plan.profile.members} onClose={closeDetail} />}
    </>
  );
}

export function App() {
  const sharedHashPresent = useMemo(() => /(?:^|[#&])plan=/.test(window.location.hash), []);
  const sharedPlan = useMemo(() => {
    try { return planFromHash(); } catch { return null; }
  }, []);
  const storedPlan = useMemo(() => safeSanitizePlan(readStored(PLAN_KEY, null)), []);
  const [screen, setScreen] = useState(sharedPlan ? "plan" : "welcome");
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState(() => normalizeDraftProfile(readStored(DRAFT_KEY, DEFAULT_PROFILE), DEFAULT_PROFILE));
  const [plan, setPlan] = useState(sharedPlan);
  const [queues, setQueues] = useState(null);
  const [queueStatus, setQueueStatus] = useState("loading");
  const [generationError, setGenerationError] = useState("");
  const queuesRef = useRef(null);

  useEffect(() => writeStored(DRAFT_KEY, profile), [profile]);
  const refreshQueues = useCallback(async () => {
    const controller = new AbortController();
    setQueueStatus("loading");
    try {
      const data = await loadQueueTimes(controller.signal);
      queuesRef.current = data;
      setQueues(data);
      setQueueStatus("ready");
    } catch (error) {
      if (error.name !== "AbortError") setQueueStatus(queuesRef.current ? "stale" : "error");
    }
    return controller;
  }, []);
  useEffect(() => {
    let controller;
    refreshQueues().then((value) => { controller = value; });
    return () => controller?.abort();
  }, [refreshQueues]);

  const queueById = useMemo(() => Object.fromEntries(Object.values(ALL_ATTRACTIONS_BY_ID).map((attraction) => [attraction.id, queueForAttraction(attraction, queues)])), [queues]);
  const generate = useCallback(() => {
    setGenerationError("");
    const normalizedProfile = normalizeDraftProfile(profile, DEFAULT_PROFILE);
    const safeProfile = normalizedProfile.members.filter(isGuardian).length < 2 ? { ...normalizedProfile, splitPolicy: "never" } : normalizedProfile;
    const nextPlan = buildUniversalPlan({ ...safeProfile, queueSnapshotAt: queues?.updatedAt ?? null }, { queueById });
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
  }, [profile, queueById, queues]);

  if (screen === "welcome") {
    return <main className="welcome-shell screen-app"><div className="welcome-material"><header><span>PLAN DLA WAS</span><em>ENERGYLANDIA • BETA</em></header><section><p className="eyebrow">NIE KOLEJNY KATALOG ATRAKCJI</p><h1>Ułóżmy wam<br /><i>dobry dzień.</i></h1><p>Plan dopasowany do składu, wzrostu, wieku, kolejek i tego, na co naprawdę macie ochotę.</p>{sharedHashPresent && !sharedPlan && <div className="warning-note" role="alert"><WarningCircle size={21} weight="fill" /><span>Ten link do planu jest uszkodzony albo pochodzi ze starszej wersji. Możesz ułożyć nową trasę poniżej.</span></div>}<div className="welcome-benefits"><span><Ruler size={18} /> ograniczenia każdej osoby</span><span><ArrowsSplit size={18} /> bezpieczne podziały grupy</span><span><ForkKnife size={18} /> obiad we właściwym miejscu</span></div></section><footer><button className="primary-button" type="button" onClick={() => { setGenerationError(""); setStep(0); setScreen("onboarding"); }}>Zaczynamy <ArrowRight size={20} weight="bold" /></button>{storedPlan && <button className="resume-button" type="button" onClick={() => { setPlan(storedPlan); setScreen("plan"); }}>Wróć do zapisanego planu</button>}<small>Bez konta. Odpowiedzi i lokalizacja zostają w tej przeglądarce. Link bez imion i lokalizacji nadal zawiera wiek oraz wzrost potrzebne do ułożenia bezpiecznej trasy.</small></footer></div><div className="welcome-orbit" aria-hidden="true"><span>1</span><span>2</span><span>3</span></div></main>;
  }

  if (screen === "onboarding") return <Onboarding profile={profile} setProfile={setProfile} step={step} setStep={setStep} onGenerate={generate} queueStatus={queueStatus} queueUpdatedAt={queues?.updatedAt ?? null} onRefreshQueues={refreshQueues} generationError={generationError} />;
  if (!plan) return null;
  return <PlanView plan={plan} onEdit={() => { setGenerationError(""); setProfile(normalizeDraftProfile(plan.profile, DEFAULT_PROFILE)); setStep(0); setScreen("onboarding"); }} />;
}
