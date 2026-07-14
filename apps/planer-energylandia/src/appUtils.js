const DEFAULT_MEMBER = Object.freeze({
  adult: Object.freeze({ age: 18, height: 170 }),
  child: Object.freeze({ age: 6, height: 120 }),
});

// The planner stores the conservative lower edge of a selected range. That way
// a plan is never more permissive than the person could safely be within the
// range they chose at onboarding.
export const HEIGHT_RANGE_OPTIONS = Object.freeze([
  Object.freeze({ value: 50, label: "poniżej 80 cm" }),
  Object.freeze({ value: 80, label: "80–99 cm" }),
  Object.freeze({ value: 100, label: "100–109 cm" }),
  Object.freeze({ value: 110, label: "110–119 cm" }),
  Object.freeze({ value: 120, label: "120–129 cm" }),
  Object.freeze({ value: 130, label: "130–139 cm" }),
  Object.freeze({ value: 140, label: "140–149 cm" }),
  Object.freeze({ value: 150, label: "150–159 cm" }),
  Object.freeze({ value: 160, label: "160–169 cm" }),
  Object.freeze({ value: 170, label: "170–179 cm" }),
  Object.freeze({ value: 180, label: "180–189 cm" }),
  Object.freeze({ value: 190, label: "190–195 cm" }),
  Object.freeze({ value: 196, label: "196 cm lub więcej" }),
]);

export const CHILD_AGE_RANGE_OPTIONS = Object.freeze([
  Object.freeze({ value: 0, label: "0–3 lata" }),
  Object.freeze({ value: 4, label: "4–5 lat" }),
  Object.freeze({ value: 6, label: "6–7 lat" }),
  Object.freeze({ value: 8, label: "8–11 lat" }),
  Object.freeze({ value: 12, label: "12–15 lat" }),
  Object.freeze({ value: 16, label: "16–17 lat" }),
]);

export const ADULT_AGE_RANGE_OPTIONS = Object.freeze([
  Object.freeze({ value: 18, label: "18 lat lub więcej" }),
]);

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

function rangeFor(value, options, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return [...options].reverse().find((option) => number >= option.value) ?? null;
}

export function heightRangeFor(value) {
  return rangeFor(value, HEIGHT_RANGE_OPTIONS, { min: 50, max: 230 });
}

export function ageRangeFor(role, value) {
  const options = role === "adult" ? ADULT_AGE_RANGE_OPTIONS : CHILD_AGE_RANGE_OPTIONS;
  return rangeFor(value, options, role === "adult" ? { min: 18, max: 110 } : { min: 0, max: 17 });
}

export function heightRangeLabel(value, fallback = "nie wybrano") {
  return heightRangeFor(value)?.label ?? fallback;
}

export function ageRangeLabel(role, value, fallback = "nie wybrano") {
  return ageRangeFor(role, value)?.label ?? fallback;
}

function validTime(value, fallback) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value ?? "")) ? String(value) : fallback;
}

function validDateKey(value, fallback = null) {
  const key = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return fallback;
  const parsed = new Date(`${key}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === key ? key : fallback;
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
    const rawAge = finiteNumber(rawMember?.age, defaults.age);
    const rawHeight = finiteNumber(rawMember?.height, defaults.height);
    const age = ageRangeFor(role, rawAge)?.value ?? rawAge;
    const height = heightRangeFor(rawHeight)?.value ?? rawHeight;
    return {
      id: cleanId(rawMember?.id, `${role}-${ordinal}`, usedIds),
      role,
      name: String(rawMember?.name ?? `${role === "adult" ? "Dorosły" : "Dziecko"} ${ordinal}`).slice(0, 40),
      age,
      height,
    };
  });

  if (!members.some((member) => member.role === "adult")) {
    members.unshift({ id: cleanId("adult-1", "adult-1", usedIds), role: "adult", name: "Dorosły 1", age: 18, height: 170 });
  }
  members.splice(14);

  const preferences = source.preferences && typeof source.preferences === "object" ? source.preferences : {};
  const fallbackPreferences = base.preferences && typeof base.preferences === "object" ? base.preferences : {};
  const interests = Array.isArray(preferences.interests)
    ? [...new Set(preferences.interests.filter((interest) => INTERESTS.has(interest)))]
    : (Array.isArray(fallbackPreferences.interests) ? fallbackPreferences.interests.filter((interest) => INTERESTS.has(interest)) : []);
  const meal = source.meal && typeof source.meal === "object" ? source.meal : {};
  const fallbackMeal = base.meal && typeof base.meal === "object" ? base.meal : {};
  const entertainment = source.entertainment && typeof source.entertainment === "object" ? source.entertainment : {};
  const fallbackEntertainment = base.entertainment && typeof base.entertainment === "object" ? base.entertainment : {};

  return {
    dayCount: Math.max(1, Math.min(3, Math.round(finiteNumber(source.dayCount, base.dayCount ?? 1)))),
    visitStartDate: validDateKey(source.visitStartDate, validDateKey(base.visitStartDate, null)),
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
    entertainment: {
      includeShows: entertainment.includeShows === true || (entertainment.includeShows === undefined && fallbackEntertainment.includeShows === true),
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
