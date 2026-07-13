import { ALL_ATTRACTIONS_BY_ID, RESTAURANTS } from "./extendedData.js";
import { formatPlanTime, timeToMinutes, validatePlanSafety } from "./planner.js";

const MAX_MEMBERS = 14;
const MAX_STEPS_PER_DAY = 14;
const RESTAURANT_IDS = new Set(RESTAURANTS.map((restaurant) => restaurant.id));
const RESTAURANTS_BY_ID = Object.fromEntries(RESTAURANTS.map((restaurant) => [restaurant.id, restaurant]));
const VALID_INTERESTS = new Set(["coasters", "water", "family", "scenic"]);

function finiteOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function validTime(value, fallback) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value ?? "") ? value : fallback;
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
  if (!member || typeof member !== "object") return null;
  const role = member.role === "child" ? "child" : "adult";
  const height = Number(member.height);
  const age = Number(member.age);
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
  if (!step || typeof step !== "object") return null;
  const id = String(step.id || `day-${dayIndex + 1}-step-${stepIndex + 1}`).slice(0, 100);
  const startMin = Number(step.startMin);
  const endMin = Number(step.endMin);
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) return null;

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
    return {
      id,
      kind: "flex",
      title: String(step.title || "Bufor na prawdziwy park").slice(0, 100),
      description: String(step.description || "").slice(0, 280),
      startMin,
      endMin,
    };
  }

  if (step.kind === "ride") {
    const attraction = ALL_ATTRACTIONS_BY_ID[step.attractionId];
    if (!attraction) return null;
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
      queueMinutes: step.queueMinutes !== null && step.queueMinutes !== undefined && Number.isFinite(Number(step.queueMinutes))
        ? Math.max(0, Math.min(600, Number(step.queueMinutes)))
        : null,
      memberIds: Array.isArray(step.memberIds) ? step.memberIds.map(String).slice(0, MAX_MEMBERS) : [],
    };
  }

  if (step.kind === "split") {
    if (!ALL_ATTRACTIONS_BY_ID[step.attractionId] || !ALL_ATTRACTIONS_BY_ID[step.alternativeAttractionId]) return null;
    const assignments = Array.isArray(step.assignments)
      ? step.assignments.slice(0, 2).map((assignment) => ({
        label: String(assignment.label || "Podgrupa").slice(0, 60),
        attractionId: ALL_ATTRACTIONS_BY_ID[assignment.attractionId] ? assignment.attractionId : null,
        memberIds: Array.isArray(assignment.memberIds) ? assignment.memberIds.map(String).slice(0, MAX_MEMBERS) : [],
      }))
      : [];
    if (assignments.length !== 2 || assignments.some((assignment) => !assignment.attractionId)) return null;
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
  if (!input || input.version !== 1 || !input.profile || !Array.isArray(input.days) || input.days.length < 1 || input.days.length > 3) return null;
  const members = (input.profile.members ?? []).slice(0, MAX_MEMBERS).map(cleanMember).filter(Boolean);
  if (members.length === 0 || !members.some((member) => member.role === "adult" && member.age >= 18)) return null;
  if (new Set(members.map((member) => member.id)).size !== members.length) return null;

  const arrivalTime = validTime(input.profile.arrivalTime, "10:00");
  const departureTime = validTime(input.profile.departureTime, "20:00");
  const arrival = timeToMinutes(arrivalTime, 600);
  const departure = timeToMinutes(departureTime, 1200);
  if (departure <= arrival + 59) return null;

  const profile = {
    dayCount: input.days.length,
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
      time: validTime(input.profile.meal?.time, "13:15"),
    },
    members,
  };

  const days = input.days.map((day, dayIndex) => {
    const steps = (day.steps ?? []).slice(0, MAX_STEPS_PER_DAY)
      .map((step, stepIndex) => sanitizeStep(step, dayIndex, stepIndex))
      .filter(Boolean);
    const coreSteps = steps.filter((step) => step.kind !== "flex");
    return {
      day: dayIndex + 1,
      label: `Dzień ${dayIndex + 1}`,
      steps,
      stats: {
        attractions: steps.reduce((total, step) => total + (step.kind === "split" ? 2 : step.kind === "ride" ? 1 : 0), 0),
        walkingMinutes: Math.round(steps.reduce((total, step) => total + finiteOr(step.walkingMinutes, 0), 0)),
        start: formatPlanTime(arrival),
        end: formatPlanTime(steps.at(-1)?.endMin ?? arrival),
        coreEnd: formatPlanTime(coreSteps.at(-1)?.endMin ?? arrival),
      },
    };
  });
  const plan = {
    version: 1,
    generatedAt: Number.isFinite(Date.parse(input.generatedAt)) ? new Date(input.generatedAt).toISOString() : new Date().toISOString(),
    profile,
    days,
    queueSnapshotAt: Number.isFinite(Number(input.queueSnapshotAt)) ? Number(input.queueSnapshotAt) : null,
  };
  const safety = validatePlanSafety(plan);
  if (!safety.valid) return null;
  const firstAttractionId = days.flatMap((day) => day.steps)
    .find((step) => step.kind === "ride" || step.kind === "split")?.attractionId ?? null;
  return { ...plan, safety, firstAttractionId };
}

export function encodePlan(plan) {
  return toBase64Url(JSON.stringify(plan));
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
  url.hash = `plan=${encodePlan(plan)}`;
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
      if (step.kind === "flex") return `${time}–${formatPlanTime(step.endMin)} — ${step.title}`;
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
