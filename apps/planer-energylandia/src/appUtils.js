const DEFAULT_MEMBER = Object.freeze({
  adult: Object.freeze({ age: 35, height: 175 }),
  child: Object.freeze({ age: 6, height: 120 }),
});

const INTERESTS = new Set(["coasters", "water", "family", "scenic"]);
const INTENSITIES = new Set(["calm", "mixed", "thrill"]);
const PACES = new Set(["easy", "normal", "fast"]);
const SPLIT_POLICIES = new Set(["never", "worthwhile", "often"]);
const WET_PREFERENCES = new Set(["avoid", "ok", "want"]);
const MEAL_MODES = new Set(["fast", "sit-down", "own", "none"]);

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function validTime(value, fallback) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value ?? "")) ? String(value) : fallback;
}

function cleanId(value, fallback, used) {
  const base = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 48) || fallback;
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

export function normalizeDraftProfile(input, fallback) {
  const base = fallback && typeof fallback === "object" ? fallback : {};
  const source = input && typeof input === "object" ? input : {};
  const rawMembers = Array.isArray(source.members) && source.members.length
    ? source.members.slice(0, 14)
    : (Array.isArray(base.members) ? base.members : []);
  const usedIds = new Set();
  const members = rawMembers.map((rawMember, index) => {
    const role = rawMember?.role === "child" ? "child" : "adult";
    const defaults = DEFAULT_MEMBER[role];
    const ordinal = rawMembers.slice(0, index + 1).filter((member) => (member?.role === "child" ? "child" : "adult") === role).length;
    return {
      id: cleanId(rawMember?.id, `${role}-${ordinal}`, usedIds),
      role,
      name: String(rawMember?.name ?? `${role === "adult" ? "Dorosły" : "Dziecko"} ${ordinal}`).slice(0, 40),
      age: finiteNumber(rawMember?.age, defaults.age),
      height: finiteNumber(rawMember?.height, defaults.height),
    };
  });

  if (!members.some((member) => member.role === "adult")) {
    members.unshift({ id: cleanId("adult-1", "adult-1", usedIds), role: "adult", name: "Dorosły 1", age: 35, height: 175 });
  }
  members.splice(14);

  const preferences = source.preferences && typeof source.preferences === "object" ? source.preferences : {};
  const fallbackPreferences = base.preferences && typeof base.preferences === "object" ? base.preferences : {};
  const interests = Array.isArray(preferences.interests)
    ? [...new Set(preferences.interests.filter((interest) => INTERESTS.has(interest)))]
    : (Array.isArray(fallbackPreferences.interests) ? fallbackPreferences.interests.filter((interest) => INTERESTS.has(interest)) : []);
  const meal = source.meal && typeof source.meal === "object" ? source.meal : {};
  const fallbackMeal = base.meal && typeof base.meal === "object" ? base.meal : {};

  return {
    dayCount: Math.max(1, Math.min(3, Math.round(finiteNumber(source.dayCount, base.dayCount ?? 1)))),
    arrivalTime: validTime(source.arrivalTime, base.arrivalTime ?? "10:00"),
    departureTime: validTime(source.departureTime, base.departureTime ?? "20:00"),
    pace: PACES.has(source.pace) ? source.pace : (PACES.has(base.pace) ? base.pace : "normal"),
    splitPolicy: SPLIT_POLICIES.has(source.splitPolicy) ? source.splitPolicy : (SPLIT_POLICIES.has(base.splitPolicy) ? base.splitPolicy : "never"),
    members,
    preferences: {
      intensity: INTENSITIES.has(preferences.intensity) ? preferences.intensity : (INTENSITIES.has(fallbackPreferences.intensity) ? fallbackPreferences.intensity : "mixed"),
      interests,
      wet: WET_PREFERENCES.has(preferences.wet) ? preferences.wet : (WET_PREFERENCES.has(fallbackPreferences.wet) ? fallbackPreferences.wet : "ok"),
      maxQueue: Math.max(15, Math.min(90, Math.round(finiteNumber(preferences.maxQueue, fallbackPreferences.maxQueue ?? 30) / 15) * 15)),
    },
    meal: {
      mode: MEAL_MODES.has(meal.mode) ? meal.mode : (MEAL_MODES.has(fallbackMeal.mode) ? fallbackMeal.mode : "fast"),
      time: validTime(meal.time, fallbackMeal.time ?? "13:15"),
    },
  };
}

function readPosition(value) {
  const location = value?.location ?? value;
  const lat = Number(location?.lat ?? location?.latitude);
  const lon = Number(location?.lon ?? location?.lng ?? location?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

export function distanceMeters(start, end) {
  const a = readPosition(start);
  const b = readPosition(end);
  if (!a || !b) return null;
  const radians = (degrees) => degrees * Math.PI / 180;
  const latDelta = radians(b.lat - a.lat);
  const lonDelta = radians(b.lon - a.lon);
  const value = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lonDelta / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(value)));
}

export function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters < 0) return null;
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0).replace(".", ",")} km`;
}

export function approximateWalkingMinutes(meters) {
  return Number.isFinite(meters) && meters >= 0 ? Math.max(1, Math.ceil(meters / 65)) : null;
}

export function countPlanAttractions(plan) {
  return Array.isArray(plan?.days) ? plan.days.reduce((total, day) => total + (Array.isArray(day?.steps)
    ? day.steps.reduce((dayTotal, step) => dayTotal + (step?.kind === "ride" ? 1 : step?.kind === "split" ? step.assignments?.length ?? 0 : 0), 0)
    : 0), 0) : 0;
}

export function queueFreshness(timestamp, now = Date.now()) {
  if (timestamp === null || timestamp === undefined || timestamp === "") {
    return { state: "unknown", label: "bez czasu aktualizacji" };
  }
  const parsed = typeof timestamp === "number" ? timestamp : Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return { state: "unknown", label: "bez czasu aktualizacji" };
  const minutes = Math.max(0, Math.round((now - parsed) / 60000));
  if (minutes < 2) return { state: "fresh", label: "sprzed chwili" };
  if (minutes <= 30) return { state: "fresh", label: `${minutes} min temu` };
  if (minutes <= 120) return { state: "aging", label: `${minutes} min temu` };
  return { state: "stale", label: `${Math.max(2, Math.round(minutes / 60))} godz. temu` };
}
