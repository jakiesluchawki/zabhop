import { ALL_ATTRACTIONS_BY_ID, RESTAURANTS } from "./extendedData.js";
import { formatPlanTime, timeToMinutes, validatePlanSafety } from "./planner.js";

const MAX_MEMBERS = 14;
const MAX_STEPS_PER_DAY = 14;
const RESTAURANT_IDS = new Set(RESTAURANTS.map((restaurant) => restaurant.id));
const RESTAURANTS_BY_ID = Object.fromEntries(RESTAURANTS.map((restaurant) => [restaurant.id, restaurant]));
const VALID_INTERESTS = new Set(["coasters", "water", "family", "scenic"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteOr(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function validTime(value, fallback) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
}

function validDateKey(value) {
  const key = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const parsed = new Date(`${key}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === key ? key : null;
}

function planMinute(value) {
  const minute = finiteOr(value, NaN);
  return Number.isInteger(minute) && minute >= 0 && minute < 24 * 60 ? minute : null;
}

function toBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function cleanMember(member, index) {
  if (!isRecord(member)) return null;
  if (member.role !== "adult" && member.role !== "child") return null;
  const role = member.role;
  const height = finiteOr(member.height, NaN);
  const age = finiteOr(member.age, NaN);
  if (!Number.isFinite(height) || height < 50 || height > 230) return null;
  if (!Number.isFinite(age) || age < 0 || age > 110) return null;
  return {
    id: String(member.id || `${role}-${index + 1}`).slice(0, 40),
    role,
    name: String(member.name || (role === "adult" ? `Dorosły ${index + 1}` : `Dziecko ${index + 1}`)).slice(0, 40),
    height,
    age,
  };
}

function sanitizeStep(step, dayIndex, stepIndex) {
  if (!isRecord(step)) return null;
  const id = String(step.id || `day-${dayIndex + 1}-step-${stepIndex + 1}`).slice(0, 100);
  const startMin = planMinute(step.startMin);
  const endMin = planMinute(step.endMin);
  if (startMin === null || endMin === null || endMin <= startMin) return null;

  if (step.kind === "meal") {
    const restaurantId = RESTAURANT_IDS.has(step.restaurantId) ? step.restaurantId : null;
    const restaurant = restaurantId ? RESTAURANTS_BY_ID[restaurantId] : null;
    return {
      id,
      kind: "meal",
      restaurantId,
      title: String(step.title || "Przerwa na obiad").slice(0, 100),
      description: String(step.description || "").slice(0, 240),
      zone: restaurant?.zone ?? String(step.zone || "family-zone").slice(0, 40),
      startMin,
      endMin,
      walkingMinutes: Math.max(0, Math.min(180, finiteOr(step.walkingMinutes, 0))),
    };
  }

  if (step.kind === "flex") {
    const hasUnplannedUntil = step.unplannedUntil !== null && step.unplannedUntil !== undefined;
    const unplannedUntil = hasUnplannedUntil ? planMinute(step.unplannedUntil) : null;
    if (hasUnplannedUntil && (unplannedUntil === null || unplannedUntil <= endMin)) return null;

    const rawBackupIds = step.backupAttractionIds ?? [];
    if (!Array.isArray(rawBackupIds) || rawBackupIds.length > 3) return null;
    const backupAttractionIds = rawBackupIds.map((attractionId) => String(attractionId));
    if (
      new Set(backupAttractionIds).size !== backupAttractionIds.length
      || backupAttractionIds.some((attractionId) => !ALL_ATTRACTIONS_BY_ID[attractionId])
    ) return null;

    return {
      id,
      kind: "flex",
      title: String(step.title || "Bufor na prawdziwy park").slice(0, 100),
      description: String(step.description || "").slice(0, 280),
      startMin,
      endMin,
      unplannedUntil,
      backupAttractionIds,
    };
  }

  if (step.kind === "ride") {
    const attraction = ALL_ATTRACTIONS_BY_ID[step.attractionId];
    if (!attraction || !Array.isArray(step.memberIds) || step.memberIds.length > MAX_MEMBERS) return null;
    return {
      id,
      kind: "ride",
      attractionId: attraction.id,
      zone: attraction.zone,
      routeOrder: finiteOr(step.routeOrder, attraction.routeOrder),
      score: finiteOr(step.score, 0),
      why: String(step.why || "").slice(0, 240),
      startMin,
      endMin,
      walkingMinutes: Math.max(0, Math.min(180, finiteOr(step.walkingMinutes, 0))),
      queueMinutes: step.queueMinutes !== null && step.queueMinutes !== undefined && Number.isFinite(finiteOr(step.queueMinutes, NaN))
        ? Math.max(0, Math.min(600, finiteOr(step.queueMinutes, 0)))
        : null,
      memberIds: step.memberIds.map(String),
    };
  }

  if (step.kind === "split") {
    if (!ALL_ATTRACTIONS_BY_ID[step.attractionId] || !ALL_ATTRACTIONS_BY_ID[step.alternativeAttractionId] || !Array.isArray(step.assignments) || step.assignments.length !== 2) return null;
    const assignments = step.assignments
      .map((assignment) => isRecord(assignment) && Array.isArray(assignment.memberIds) && assignment.memberIds.length <= MAX_MEMBERS ? ({
        label: String(assignment.label || "Podgrupa").slice(0, 60),
        attractionId: ALL_ATTRACTIONS_BY_ID[assignment.attractionId] ? assignment.attractionId : null,
        memberIds: assignment.memberIds.map(String),
      }) : null);
    if (assignments.length !== 2 || assignments.some((assignment) => !assignment?.attractionId)) return null;
    const mainAttraction = ALL_ATTRACTIONS_BY_ID[assignments[0].attractionId];
    return {
      id,
      kind: "split",
      attractionId: assignments[0].attractionId,
      alternativeAttractionId: assignments[1].attractionId,
      zone: mainAttraction.zone,
      routeOrder: finiteOr(step.routeOrder, mainAttraction.routeOrder),
      score: finiteOr(step.score, 0),
      startMin,
      endMin,
      walkingMinutes: Math.max(0, Math.min(180, finiteOr(step.walkingMinutes, 0))),
      assignments,
      reunion: {
        label: String(step.reunion?.label || "Miejsce spotkania").slice(0, 100),
        time: formatPlanTime(endMin),
      },
    };
  }
  return null;
}

export function sanitizeSharedPlan(input) {
  if (!isRecord(input) || input.version !== 1 || !isRecord(input.profile) || !Array.isArray(input.days) || input.days.length < 1 || input.days.length > 3) return null;
  if (!Array.isArray(input.profile.members) || input.profile.members.length < 1 || input.profile.members.length > MAX_MEMBERS) return null;
  const members = input.profile.members.map(cleanMember);
  if (members.some((member) => member === null) || !members.some((member) => member.role === "adult" && member.age >= 18)) return null;
  if (new Set(members.map((member) => member.id)).size !== members.length) return null;

  const arrivalTime = validTime(input.profile.arrivalTime, "10:00");
  const departureTime = validTime(input.profile.departureTime, "20:00");
  const arrival = timeToMinutes(arrivalTime, 600);
  const departure = timeToMinutes(departureTime, 1200);
  if (departure <= arrival + 59) return null;

  const requestedMealTime = validTime(input.profile.meal?.time, "13:15");
  const requestedMealMinute = timeToMinutes(requestedMealTime, 795);
  const mealTime = requestedMealMinute > arrival && requestedMealMinute < departure
    ? requestedMealTime
    : formatPlanTime(Math.round((arrival + departure) / 2));
  const profile = {
    dayCount: input.days.length,
    visitStartDate: validDateKey(input.profile.visitStartDate),
    arrivalTime,
    departureTime,
    pace: new Set(["easy", "normal", "fast"]).has(input.profile.pace) ? input.profile.pace : "normal",
    splitPolicy: new Set(["never", "worthwhile", "often"]).has(input.profile.splitPolicy) ? input.profile.splitPolicy : "never",
    preferences: {
      intensity: new Set(["calm", "mixed", "thrill"]).has(input.profile.preferences?.intensity) ? input.profile.preferences.intensity : "mixed",
      interests: Array.isArray(input.profile.preferences?.interests)
        ? [...new Set(input.profile.preferences.interests.filter((item) => VALID_INTERESTS.has(item)))].slice(0, 4)
        : [],
      wet: new Set(["avoid", "ok", "want"]).has(input.profile.preferences?.wet) ? input.profile.preferences.wet : "ok",
      maxQueue: Math.max(15, Math.min(90, finiteOr(input.profile.preferences?.maxQueue, 45))),
    },
    meal: {
      mode: new Set(["fast", "sit-down", "own", "none"]).has(input.profile.meal?.mode) ? input.profile.meal.mode : "fast",
      time: mealTime,
    },
    members,
  };

  const seenStepIds = new Set();
  const seenAttractionIds = new Set();
  let attractionCount = 0;
  const days = [];
  for (let dayIndex = 0; dayIndex < input.days.length; dayIndex += 1) {
    const day = input.days[dayIndex];
    if (!isRecord(day) || !Array.isArray(day.steps) || day.steps.length > MAX_STEPS_PER_DAY) return null;
    const steps = [];
    let mealCount = 0;
    let flexCount = 0;
    for (let stepIndex = 0; stepIndex < day.steps.length; stepIndex += 1) {
      const step = sanitizeStep(day.steps[stepIndex], dayIndex, stepIndex);
      // Nie pomijamy uszkodzonego kroku po cichu: zmieniłoby to znaczenie
      // udostępnionej trasy i mogłoby ukryć niebezpieczny przydział grupy.
      if (!step || seenStepIds.has(step.id)) return null;
      if (step.kind === "meal" && ++mealCount > 1) return null;
      if (step.kind === "flex") {
        if (++flexCount > 1 || stepIndex !== day.steps.length - 1) return null;
        // Starsze linki powstały po sanitizacji, która usuwała informację o
        // swobodnym odcinku dnia. Końcowy bufor zawsze oznacza horyzont do
        // zadeklarowanego wyjścia, więc możemy go bezpiecznie odtworzyć.
        if (step.unplannedUntil === null && step.endMin < departure) {
          step.unplannedUntil = departure;
        }
        if (step.unplannedUntil !== null && step.unplannedUntil !== departure) return null;
      }
      seenStepIds.add(step.id);
      const attractionIds = step.kind === "ride"
        ? [step.attractionId]
        : step.kind === "split"
          ? step.assignments.map((assignment) => assignment.attractionId)
          : [];
      if (attractionIds.some((id) => seenAttractionIds.has(id)) || new Set(attractionIds).size !== attractionIds.length) return null;
      attractionIds.forEach((id) => seenAttractionIds.add(id));
      attractionCount += attractionIds.length;
      steps.push(step);
    }
    const coreSteps = steps.filter((step) => step.kind !== "flex");
    const finalStep = steps.at(-1);
    const horizonEnd = finalStep?.kind === "flex"
      ? finalStep.unplannedUntil ?? finalStep.endMin
      : finalStep?.endMin ?? arrival;
    // Udostępniony plan nie może po sanitizacji wyglądać na krótszy niż
    // zadeklarowana wizyta. Nowy planer zawsze domyka ten horyzont końcowym
    // krokiem lub buforem; niepełny payload odrzucamy zamiast go skracać.
    if (horizonEnd !== departure) return null;
    days.push({
      day: dayIndex + 1,
      label: `Dzień ${dayIndex + 1}`,
      steps,
      stats: {
        attractions: steps.reduce((total, step) => total + (step.kind === "split" ? 2 : step.kind === "ride" ? 1 : 0), 0),
        walkingMinutes: Math.round(steps.reduce((total, step) => total + finiteOr(step.walkingMinutes, 0), 0)),
        start: formatPlanTime(arrival),
        end: formatPlanTime(horizonEnd),
        coreEnd: formatPlanTime(coreSteps.at(-1)?.endMin ?? arrival),
        declaredDeparture: formatPlanTime(departure),
      },
    });
  }
  if (attractionCount === 0) return null;
  const plan = {
    version: 1,
    generatedAt: typeof input.generatedAt === "string" && Number.isFinite(Date.parse(input.generatedAt)) ? new Date(input.generatedAt).toISOString() : new Date().toISOString(),
    profile,
    days,
    queueSnapshotAt: Number.isFinite(finiteOr(input.queueSnapshotAt, NaN)) ? finiteOr(input.queueSnapshotAt, null) : null,
  };
  const safety = validatePlanSafety(plan);
  if (!safety.valid) return null;
  const firstAttractionId = days.flatMap((day) => day.steps)
    .find((step) => step.kind === "ride" || step.kind === "split")?.attractionId ?? null;
  return { ...plan, safety, firstAttractionId };
}

export function encodePlan(plan) {
  const sanitized = sanitizeSharedPlan(plan);
  if (!sanitized) return "";

  // Wiek i wzrost są potrzebne do ponownej weryfikacji ograniczeń atrakcji.
  // Imiona i potencjalnie identyfikujące ID nie są — link dostaje neutralne
  // oznaczenia, a przydziały podgrup są przepinane na nowe identyfikatory.
  const roleCounts = { adult: 0, child: 0 };
  const memberIdMap = new Map();
  const members = sanitized.profile.members.map((member) => {
    roleCounts[member.role] += 1;
    const ordinal = roleCounts[member.role];
    const id = `${member.role}-${ordinal}`;
    memberIdMap.set(member.id, id);
    return {
      id,
      role: member.role,
      name: member.role === "adult" ? `Dorosły ${ordinal}` : `Dziecko ${ordinal}`,
      age: member.age,
      height: member.height,
    };
  });
  const days = sanitized.days.map((day) => ({
    steps: day.steps.map((step) => {
      if (step.kind === "ride") {
        return { ...step, memberIds: step.memberIds.map((id) => memberIdMap.get(id)) };
      }
      if (step.kind === "split") {
        return {
          ...step,
          assignments: step.assignments.map((assignment) => ({
            ...assignment,
            memberIds: assignment.memberIds.map((id) => memberIdMap.get(id)),
          })),
        };
      }
      return step;
    }),
  }));
  const snapshot = {
    version: 1,
    generatedAt: sanitized.generatedAt,
    queueSnapshotAt: sanitized.queueSnapshotAt,
    profile: { ...sanitized.profile, members },
    days,
  };
  return toBase64Url(JSON.stringify(snapshot));
}

export function decodePlan(payload) {
  try {
    if (!payload || payload.length > 24_000) return null;
    return sanitizeSharedPlan(JSON.parse(fromBase64Url(payload)));
  } catch {
    return null;
  }
}

export function planFromHash(hash = window.location.hash) {
  const match = String(hash).match(/^#plan=([^&]+)$/);
  return match ? decodePlan(match[1]) : null;
}

export function createPlanUrl(plan) {
  const url = new URL(window.location.href);
  const payload = encodePlan(plan);
  url.hash = payload ? `plan=${payload}` : "";
  return url.toString();
}

export function createEmailDraftUrl(email, planUrl, plan) {
  const memberById = Object.fromEntries((plan?.profile?.members ?? []).map((member) => [member.id, member.name]));
  const itinerary = (plan?.days ?? []).flatMap((day) => [
    "",
    `${day.label} (${day.stats?.start ?? ""}–${day.stats?.end ?? ""})`,
    ...(day.steps ?? []).map((step) => {
      const time = formatPlanTime(step.startMin);
      if (step.kind === "ride") return `${time} — ${ALL_ATTRACTIONS_BY_ID[step.attractionId]?.name ?? "Atrakcja"} — wszyscy`;
      if (step.kind === "meal") return `${time} — ${step.title}`;
      if (step.kind === "flex") return `${time}–${formatPlanTime(step.unplannedUntil ?? step.endMin)} — ${step.title}`;
      if (step.kind === "split") {
        const routes = step.assignments.map((assignment) => {
          const ride = ALL_ATTRACTIONS_BY_ID[assignment.attractionId]?.name ?? "Atrakcja";
          const people = assignment.memberIds.map((id) => memberById[id]).filter(Boolean).join(", ");
          return `${ride}: ${people}`;
        }).join(" | ");
        return `${time} — PODZIAŁ — ${routes} — spotkanie ${step.reunion?.time ?? ""}`;
      }
      return null;
    }).filter(Boolean),
  ]);
  const baseUrl = new URL(planUrl);
  baseUrl.hash = "";
  const subject = "Nasz plan Energylandii";
  const body = [
    "Cześć!",
    "",
    `Tu jest nasz plan Energylandii na ${plan?.days?.length ?? 1} ${plan?.days?.length === 1 ? "dzień" : "dni"}:`,
    ...itinerary,
    "",
    `Aplikacja: ${baseUrl.toString()}`,
    "PDF można zapisać w aplikacji przyciskiem „Drukuj / zapisz PDF” i dołączyć do tej wiadomości.",
    "",
    "Ograniczenia przy wejściu i decyzja obsługi parku zawsze mają pierwszeństwo.",
  ].filter(Boolean).join("\n");
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
