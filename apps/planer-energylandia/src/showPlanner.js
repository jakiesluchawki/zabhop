import { formatPlanTime, timeToMinutes, validatePlanSafety } from "./planner.js";
import { showScheduleFreshness, showsOnDate } from "./shows.js";

const MIN_FINAL_BUFFER_MINUTES = 60;
const MAX_WAIT_FOR_SHOW_MINUTES = 60;
const WALK_AND_SETTLE_MINUTES = 10;

function dateForDay(plan, dayIndex) {
  const start = String(plan?.profile?.visitStartDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const date = new Date(`${start}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dayIndex);
  return date.toISOString().slice(0, 10);
}

function cloneDay(day) {
  return { ...day, steps: (day.steps || []).map((step) => ({ ...step, backupAttractionIds: [...(step.backupAttractionIds || [])] })) };
}

function candidateForDay(day, shows, departure) {
  const flex = day?.steps?.at(-1);
  if (!flex || flex.kind !== "flex") return null;
  const candidates = [];
  for (const show of shows) {
    for (const time of show.times || []) {
      const performanceStartMin = timeToMinutes(time, -1);
      const performanceEndMin = performanceStartMin + show.durationMinutes;
      const waitMinutes = performanceStartMin - flex.startMin;
      if (
        performanceStartMin < flex.startMin + WALK_AND_SETTLE_MINUTES
        || waitMinutes > MAX_WAIT_FOR_SHOW_MINUTES
        || performanceEndMin + MIN_FINAL_BUFFER_MINUTES > departure
      ) continue;
      candidates.push({ show, performanceStartMin, performanceEndMin, waitMinutes, flex });
    }
  }
  return candidates.sort((a, b) => a.waitMinutes - b.waitMinutes || a.performanceStartMin - b.performanceStartMin || a.show.title.localeCompare(b.show.title, "pl"))[0] || null;
}

function addShowToDay(day, candidate, departure) {
  const { show, performanceStartMin, performanceEndMin, waitMinutes, flex } = candidate;
  const postShowDuration = Math.min(90, departure - performanceEndMin);
  const postShowEnd = performanceEndMin + postShowDuration;
  const showStep = {
    id: `${flex.id}-show-${show.id}-${performanceStartMin}`.slice(0, 100),
    kind: "show",
    showId: show.id,
    title: show.title,
    description: show.description || `${waitMinutes > WALK_AND_SETTLE_MINUTES ? "Dojście i chwila na zajęcie miejsc, potem " : "Dojście i "}${show.durationMinutes}-minutowy pokaz.`,
    venue: show.venue,
    officialUrl: show.url,
    mapUrl: show.mapUrl,
    imageUrl: show.imageUrl,
    performanceTimes: [...show.times],
    sourceCheckedAt: show.checkedAt,
    startMin: flex.startMin,
    performanceStartMin,
    endMin: performanceEndMin,
    durationMinutes: show.durationMinutes,
    walkingMinutes: WALK_AND_SETTLE_MINUTES,
  };
  const flexStep = {
    ...flex,
    id: `${flex.id}-after-show`,
    startMin: performanceEndMin,
    endMin: postShowEnd,
    unplannedUntil: postShowEnd < departure ? departure : null,
    title: "Bufor po pokazie",
    description: "Pokaz nie skraca rdzenia trasy. Nadal zostawiamy minimum godzinę na kolejki, WC, odpoczynek i bezpieczne domknięcie dnia.",
  };
  const steps = [...day.steps.slice(0, -1), showStep, flexStep];
  return {
    ...day,
    steps,
    stats: {
      ...day.stats,
      end: formatPlanTime(departure),
      coreEnd: formatPlanTime(performanceEndMin),
    },
  };
}

/**
 * The show layer is deliberately an overlay, not an input to ride ranking. It
 * only uses an already-reserved final flex window, so a successful insertion
 * cannot delete a ride, meal break or the final 60-minute safety buffer.
 */
export function overlayShowsOnPlan(basePlan, showData, { now = Date.now() } = {}) {
  if (!basePlan?.profile?.entertainment?.includeShows) return basePlan;
  const freshness = showScheduleFreshness(showData, now);
  if (freshness.state !== "fresh") return basePlan;
  const departure = timeToMinutes(basePlan.profile.departureTime, 1_200);
  const days = basePlan.days.map(cloneDay).map((day, dayIndex) => {
    const dateKey = dateForDay(basePlan, dayIndex);
    const shows = showsOnDate(showData, dateKey, { schedulableOnly: true }).filter((show) => Boolean(show.mapUrl));
    const candidate = candidateForDay(day, shows, departure);
    return candidate ? addShowToDay(day, candidate, departure) : day;
  });
  const plan = { ...basePlan, days };
  const safety = validatePlanSafety(plan);
  return safety.valid ? { ...plan, safety } : basePlan;
}
