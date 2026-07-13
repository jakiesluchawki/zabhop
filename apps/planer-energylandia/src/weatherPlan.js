import { chooseRecommendation } from "./decision.js";
import { evaluateRainAlert } from "./rainAlert.js";
import { nextLocalHour } from "./weather.js";

const DEFAULT_THRESHOLDS = Object.freeze({
  twoDayMinimum: 50,
  twoDayAverage: 65,
  threeDayMinimum: 55,
  threeDayAverage: 70,
});

function finiteScore(day) {
  const value = day?.recommendation?.score ?? day?.score;
  return Number.isFinite(value) ? value : null;
}

function confidenceOf(day) {
  return day?.recommendation?.confidence ?? day?.confidence ?? "niska";
}

function dateKeyOf(day) {
  return day?.dateKey ?? day?.day ?? null;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundAverage(values) {
  return Math.round(average(values));
}

function describeWindow(days) {
  const keys = days.map(dateKeyOf).filter(Boolean);
  if (keys.length === days.length) return keys.join(" → ");
  return days.map((day) => `dzień ${(day?.index ?? 0) + 1}`).join(" → ");
}

function candidate(days, startIndex, length) {
  const selected = days.slice(startIndex, startIndex + length);
  if (selected.length !== length) return null;
  const scores = selected.map(finiteScore);
  if (scores.some((score) => score == null)) return null;
  return {
    startIndex,
    endIndex: startIndex + length - 1,
    days: selected,
    scores,
    average: average(scores),
    minimum: Math.min(...scores),
    hasLowConfidence: selected.some((day) => confidenceOf(day) === "niska"),
  };
}

function sortCandidates(a, b) {
  return b.average - a.average
    || b.minimum - a.minimum
    || a.startIndex - b.startIndex;
}

function overallConfidence(selected, allDays) {
  if (!selected.length) return "niska";
  if (selected.some((day) => confidenceOf(day) === "niska")) return "niska";
  const complete = allDays.length === 3 && allDays.every((day) => finiteScore(day) != null);
  if (complete && selected.every((day) => confidenceOf(day) === "wysoka")) return "wysoka";
  return "średnia";
}

function selectedPayload(candidateValue) {
  return {
    selectedIndices: candidateValue.days.map((day, offset) => day?.index ?? candidateValue.startIndex + offset),
    selectedDateKeys: candidateValue.days.map(dateKeyOf).filter(Boolean),
    score: Math.round(candidateValue.average),
  };
}

/**
 * Recommends a commitment of one, two or three consecutive park days.
 *
 * Every item may have `{ dateKey, recommendation }` (the shape returned by
 * `assessThreeDayWeather`) or expose `score` and `confidence` directly. Missing
 * scores are never silently treated as good weather. A multi-day recommendation
 * additionally requires at least medium confidence for every selected day.
 */
export function recommendVisitLength(daysInput, options = {}) {
  const days = Array.isArray(daysInput) ? daysInput.slice(0, 3) : [];
  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const knownDays = days.filter((day) => finiteScore(day) != null);
  const missingCount = Math.max(0, 3 - knownDays.length);
  const warnings = [];

  if (missingCount > 0) {
    warnings.push(`Brakuje uczciwej oceny dla ${missingCount} z 3 dni — brak danych nie jest traktowany jak dobra pogoda.`);
  }

  if (!knownDays.length) {
    return {
      dayCount: null,
      status: "insufficient-data",
      confidence: "niska",
      selectedIndices: [],
      selectedDateKeys: [],
      score: null,
      headline: "Za mało danych, żeby wybrać liczbę dni.",
      summary: "Nie kupuj dłuższego pobytu wyłącznie na podstawie niepełnej prognozy.",
      reasons: ["Żaden z trzech dni nie ma wiarygodnej oceny godzinowej."],
      warnings,
    };
  }

  const three = candidate(days, 0, 3);
  if (
    three
    && !three.hasLowConfidence
    && three.minimum >= thresholds.threeDayMinimum
    && three.average >= thresholds.threeDayAverage
  ) {
    const conditional = three.minimum < 70;
    return {
      dayCount: 3,
      status: conditional ? "conditional" : "recommended",
      confidence: overallConfidence(three.days, days),
      ...selectedPayload(three),
      headline: conditional ? "Trzy dni, ale z planem B." : "Pogoda broni trzech dni.",
      summary: `Wszystkie trzy kolejne dni przechodzą ostrożny próg; średnia ocena to ${roundAverage(three.scores)}/100.`,
      reasons: [
        `Pełny ciąg: ${describeWindow(three.days)}.`,
        `Najsłabszy dzień ma ${Math.round(three.minimum)}/100.`,
        "Każdy dzień ma co najmniej średnią pewność danych.",
      ],
      warnings,
    };
  }

  const pairs = [candidate(days, 0, 2), candidate(days, 1, 2)]
    .filter(Boolean)
    .filter((item) => !item.hasLowConfidence)
    .filter((item) => item.minimum >= thresholds.twoDayMinimum && item.average >= thresholds.twoDayAverage)
    .sort(sortCandidates);

  if (pairs.length) {
    const best = pairs[0];
    const conditional = best.minimum < 70 || missingCount > 0;
    return {
      dayCount: 2,
      status: conditional ? "conditional" : "recommended",
      confidence: overallConfidence(best.days, days),
      ...selectedPayload(best),
      headline: conditional ? "Dwa dni są rozsądnym maksimum." : "Najlepszy wybór: dwa dni.",
      summary: `Najlepsza para kolejnych dni ma średnio ${roundAverage(best.scores)}/100.`,
      reasons: [
        `Najlepszy ciąg: ${describeWindow(best.days)}.`,
        `Najsłabszy z wybranych dni ma ${Math.round(best.minimum)}/100.`,
        three?.hasLowConfidence
          ? "Trzydniowy pobyt odpada przez niską pewność przynajmniej jednego dnia."
          : "Trzeci dzień nie przechodzi ostrożnego progu dla dłuższego pobytu.",
      ],
      warnings,
    };
  }

  const bestDay = knownDays
    .map((day, fallbackIndex) => ({
      day,
      index: day?.index ?? days.indexOf(day) ?? fallbackIndex,
      score: finiteScore(day),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0];
  const confidence = overallConfidence([bestDay.day], days);
  const status = bestDay.score < 45 ? "avoid" : "conditional";
  if (confidence === "niska") {
    warnings.push("Niska pewność danych ogranicza rekomendację do jednego dnia.");
  }

  return {
    dayCount: 1,
    status,
    confidence,
    selectedIndices: [bestDay.index],
    selectedDateKeys: [dateKeyOf(bestDay.day)].filter(Boolean),
    score: Math.round(bestDay.score),
    headline: status === "avoid" ? "Nie rezerwuj dłuższego pobytu." : "Na razie planuj jeden dzień.",
    summary: status === "avoid"
      ? `Nawet najlepszy dzień ma tylko ${Math.round(bestDay.score)}/100; jeśli jedziecie, potraktujcie to warunkowo.`
      : `Najlepszy pojedynczy dzień ma ${Math.round(bestDay.score)}/100, ale brak bezpiecznego ciągu na dwa dni.`,
    reasons: [
      `Najlepszy wybór: ${dateKeyOf(bestDay.day) || `dzień ${bestDay.index + 1}`}.`,
      "Żadna para kolejnych dni nie spełnia progu jakości i pewności.",
    ],
    warnings,
  };
}

/**
 * Turns the raw three-day weather payload into day cards, a visit-length verdict,
 * and a separate live rain alert. Keeping the live alert separate matters: ICM
 * and hourly models explain the day, while fresh Antistorm drives "leave now".
 */
export function assessThreeDayWeather(weather, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const safeNow = Number.isFinite(now.getTime()) ? now : new Date();
  const parkOpen = options.parkOpen ?? 10;
  const parkClose = options.parkClose ?? 20;
  const visitHours = options.visitHours ?? 5;
  // Keep all three calendar slots. Collapsing a missing `today` key would make
  // tomorrow look like today and could incorrectly apply the live nowcast to it.
  const keys = [weather?.today ?? null, weather?.tomorrow ?? null, weather?.dayAfterTomorrow ?? null];
  const icmAvailable = Boolean(weather?.icm);
  const numericSourceCount = Number.isFinite(weather?.numericSourceCount) ? weather.numericSourceCount : 0;

  const days = keys.map((dateKey, index) => {
    const hours = dateKey ? weather?.days?.[dateKey] || [] : [];
    const recommendation = chooseRecommendation(hours, {
      parkOpen,
      parkClose,
      visitHours,
      earliestStart: index === 0 ? Math.max(parkOpen, nextLocalHour(safeNow)) : parkOpen,
      icmAvailable,
      numericSourceCount,
      applyAntistorm: index === 0,
      antistorm: index === 0 ? weather?.antistorm : null,
      now: safeNow,
    });
    return { index, dateKey, isToday: index === 0, recommendation };
  });

  const todayHours = weather?.today ? weather?.days?.[weather.today] || [] : [];
  const rainAlert = evaluateRainAlert({
    antistorm: weather?.antistorm,
    antistormCheckedAt: weather?.antistorm?.updatedAt,
    hours: todayHours,
    now: safeNow,
    carWalkMinutes: options.carWalkMinutes ?? 30,
  });

  return {
    days,
    visit: recommendVisitLength(days, options),
    rainAlert,
    sources: weather?.sources || [],
    updatedAt: weather?.updatedAt || null,
  };
}
