export const RAIN_ALERT_STATE = Object.freeze({
  CLEAR: "clear",
  LEAVE_NOW: "leave-now",
  RAINING: "raining",
  SHELTER_NOW: "shelter-now",
  UNAVAILABLE: "unavailable",
});

export const RAIN_ALERT_SOURCE_URLS = Object.freeze({
  antistorm: "https://antistorm.eu/deweloperzy.php",
  openMeteo: "https://open-meteo.com/en/docs",
});

const ANTISTORM_UNKNOWN_ETA = 255;
const ANTISTORM_SIGNIFICANT_SIGNAL = 10;
const DEFAULT_STALE_AFTER_MINUTES = 35;
const DEFAULT_CAR_WALK_MINUTES = 30;
const MINUTELY_RAIN_THRESHOLD_MM = 0.05;

function finiteNumber(value) {
  if (value === "" || value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
function validDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function minutesBetween(older, newer) {
  return Math.max(0, (newer.getTime() - older.getTime()) / 60_000);
}

function freshness(checkedAtValue, now, staleAfterMinutes) {
  const checkedAt = validDate(checkedAtValue);
  if (!checkedAt) return { state: "unknown", checkedAt: null, ageMinutes: null };
  const ageMinutes = minutesBetween(checkedAt, now);
  return {
    state: ageMinutes <= staleAfterMinutes ? "fresh" : "stale",
    checkedAt: checkedAt.toISOString(),
    ageMinutes: Math.round(ageMinutes),
  };
}

function antistormEvidence(antistorm, checkedAtValue, now, staleAfterMinutes) {
  if (!antistorm || typeof antistorm !== "object") return null;
  const rainSignal = finiteNumber(antistorm.p_o);
  const rainEta = finiteNumber(antistorm.t_o);
  const rainAlarm = finiteNumber(antistorm.a_o) === 1;
  const stormSignal = finiteNumber(antistorm.p_b);
  const stormEta = finiteNumber(antistorm.t_b);
  const stormAlarm = finiteNumber(antistorm.a_b) === 1;
  const stormOverhead = finiteNumber(antistorm.s) === 1;
  const rainEtaKnown = rainEta != null && rainEta >= 0 && rainEta < ANTISTORM_UNKNOWN_ETA;
  const stormEtaKnown = stormEta != null && stormEta >= 0 && stormEta < ANTISTORM_UNKNOWN_ETA;
  const credibleRain = rainAlarm || (rainSignal != null && rainSignal > ANTISTORM_SIGNIFICANT_SIGNAL);
  const credibleStorm = stormAlarm || stormOverhead
    || (stormSignal != null && stormSignal > ANTISTORM_SIGNIFICANT_SIGNAL);

  return {
    source: "antistorm",
    href: RAIN_ALERT_SOURCE_URLS.antistorm,
    station: typeof antistorm.m === "string" && antistorm.m.trim() ? antistorm.m.trim() : "najbliższy punkt Antistorm",
    freshness: freshness(checkedAtValue, now, staleAfterMinutes),
    rainSignal,
    rainEta: credibleRain && rainEtaKnown ? rainEta : null,
    rainOngoing: credibleRain && rainEtaKnown && rainEta === 0,
    stormSignal,
    stormEta: credibleStorm && stormEtaKnown ? stormEta : null,
    stormOverhead,
    // Antistorm documents p_o/p_b as a raw 0–255 signal, not a percentage.
    rawScale: "0-255",
  };
}

function minutelyEvidence(minutely, checkedAtValue, now, staleAfterMinutes) {
  if (!Array.isArray(minutely) || minutely.length === 0) return null;
  const sourceFreshness = freshness(checkedAtValue, now, staleAfterMinutes);
  const points = minutely
    .map((point) => {
      const time = validDate(point?.time);
      const precipitation = Math.max(
        finiteNumber(point?.precipitation) || 0,
        finiteNumber(point?.rain) || 0,
        finiteNumber(point?.showers) || 0,
      );
      return time ? { time, precipitation } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
  if (!points.length) return null;

  const wetPoints = points.filter((point) => point.precipitation >= MINUTELY_RAIN_THRESHOLD_MM);
  const currentWet = wetPoints.find((point) => {
    const offset = (point.time.getTime() - now.getTime()) / 60_000;
    // Open-Meteo 15-minute precipitation is a sum for the preceding interval.
    return offset >= -15 && offset <= 0;
  });
  const nextWet = wetPoints.find((point) => point.time > now);

  return {
    source: "open-meteo-minutely-15",
    href: RAIN_ALERT_SOURCE_URLS.openMeteo,
    freshness: sourceFreshness,
    rainOngoing: Boolean(currentWet),
    rainEta: nextWet ? Math.max(0, Math.ceil(minutesBetween(now, nextWet.time))) : null,
    precipitationMm: (currentWet || nextWet)?.precipitation ?? null,
  };
}

function hourlyContext(hours, now) {
  if (!Array.isArray(hours) || hours.length === 0) return null;
  const currentHour = now.getHours();
  const upcoming = hours.filter((hour) => finiteNumber(hour?.hour) >= currentHour).slice(0, 2);
  if (!upcoming.length) return null;
  return {
    maxProbability: Math.max(0, ...upcoming.map((hour) => finiteNumber(hour?.precipProbability) || 0)),
    maxPrecipitationMm: Math.max(0, ...upcoming.map((hour) => finiteNumber(hour?.precipitation) || 0)),
    note: "Prognoza godzinowa daje tylko kontekst; nie potwierdza opadu w ciągu 30 minut.",
  };
}

function unavailable(reason, evidence, context, carWalkMinutes) {
  return {
    state: RAIN_ALERT_STATE.UNAVAILABLE,
    urgent: false,
    hazard: null,
    etaMinutes: null,
    carWalkMinutes,
    reason,
    confidence: "unknown",
    primarySource: null,
    evidence,
    hourlyContext: context,
  };
}

/**
 * Decide whether visitors should start the walk to the car because of immediate rain.
 *
 * `antistormCheckedAt` must be the time the API response was fetched. Antistorm does
 * not include the time of its underlying calculation, so the result deliberately
 * calls this freshness "checked", not "observed" or "updated".
 *
 * Optional `minutely` points use the shape returned by Open-Meteo's `minutely_15`
 * arrays after zipping: `{ time, precipitation, rain, showers }`.
 */
export function evaluateRainAlert({
  antistorm = null,
  antistormCheckedAt = antistorm?.fetchedAt || antistorm?.updatedAt || null,
  minutely = [],
  minutelyCheckedAt = null,
  hours = [],
  now: nowValue = new Date(),
  staleAfterMinutes = DEFAULT_STALE_AFTER_MINUTES,
  carWalkMinutes = DEFAULT_CAR_WALK_MINUTES,
} = {}) {
  const now = validDate(nowValue) || new Date();
  const safeStaleAfter = Math.max(1, finiteNumber(staleAfterMinutes) || DEFAULT_STALE_AFTER_MINUTES);
  const safeCarWalk = Math.max(1, finiteNumber(carWalkMinutes) || DEFAULT_CAR_WALK_MINUTES);
  const antistormData = antistormEvidence(antistorm, antistormCheckedAt, now, safeStaleAfter);
  const minutelyData = minutelyEvidence(minutely, minutelyCheckedAt, now, safeStaleAfter);
  const evidence = [antistormData, minutelyData].filter(Boolean);
  const context = hourlyContext(hours, now);
  const freshEvidence = evidence.filter((item) => item.freshness.state === "fresh");

  if (!freshEvidence.length) {
    const hasStale = evidence.some((item) => item.freshness.state === "stale");
    return unavailable(hasStale ? "stale" : "missing", evidence, context, safeCarWalk);
  }

  // A storm that is already overhead is no longer a safe "walk to the car"
  // window. Check this before ongoing rain so a simultaneous rain signal cannot
  // weaken the more important shelter instruction.
  const immediateStorm = freshEvidence.find((item) => item.stormOverhead || item.stormEta === 0);
  if (immediateStorm) {
    return {
      state: RAIN_ALERT_STATE.SHELTER_NOW,
      urgent: true,
      hazard: "storm",
      etaMinutes: 0,
      carWalkMinutes: safeCarWalk,
      reason: immediateStorm.stormOverhead ? "storm-overhead" : "storm-arriving-now",
      confidence: immediateStorm.source === "antistorm" ? "nearby-nowcast" : "model-nowcast",
      primarySource: immediateStorm.source,
      evidence,
      hourlyContext: context,
    };
  }

  const ongoing = freshEvidence.find((item) => item.rainOngoing);
  if (ongoing) {
    return {
      state: RAIN_ALERT_STATE.RAINING,
      urgent: true,
      hazard: "rain",
      etaMinutes: 0,
      carWalkMinutes: safeCarWalk,
      reason: "rain-ongoing",
      confidence: ongoing.source === "antistorm" ? "nearby-nowcast" : "model-nowcast",
      primarySource: ongoing.source,
      evidence,
      hourlyContext: context,
    };
  }

  const imminent = freshEvidence
    .flatMap((item) => [
      item.rainEta != null ? { source: item.source, hazard: "rain", etaMinutes: item.rainEta } : null,
      item.stormEta != null ? { source: item.source, hazard: "storm", etaMinutes: item.stormEta } : null,
    ])
    .filter(Boolean)
    .sort((a, b) => a.etaMinutes - b.etaMinutes)[0];

  if (imminent && imminent.etaMinutes <= safeCarWalk) {
    return {
      state: RAIN_ALERT_STATE.LEAVE_NOW,
      urgent: true,
      hazard: imminent.hazard,
      etaMinutes: imminent.etaMinutes,
      carWalkMinutes: safeCarWalk,
      reason: "arrival-within-car-walk",
      confidence: imminent.source === "antistorm" ? "nearby-nowcast" : "model-nowcast",
      primarySource: imminent.source,
      evidence,
      hourlyContext: context,
    };
  }

  return {
    state: RAIN_ALERT_STATE.CLEAR,
    urgent: false,
    hazard: imminent?.hazard || null,
    etaMinutes: imminent?.etaMinutes ?? null,
    carWalkMinutes: safeCarWalk,
    reason: imminent ? "outside-car-walk-window" : "no-immediate-signal",
    confidence: freshEvidence.some((item) => item.source === "antistorm") ? "nearby-nowcast" : "model-nowcast",
    primarySource: freshEvidence[0].source,
    evidence,
    hourlyContext: context,
  };
}
