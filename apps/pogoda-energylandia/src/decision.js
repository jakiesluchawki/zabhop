const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function stepSeverity(value, steps, fallback = 0.45) {
  if (value == null || Number.isNaN(value)) return fallback;
  for (const [limit, severity] of steps) {
    if (value < limit) return severity;
  }
  return 1;
}

const rainSeverity = (value) => stepSeverity(value, [[0.1, 0], [0.5, 0.25], [1.5, 0.55], [3, 0.8]]);
const probabilitySeverity = (value) => stepSeverity(value, [[30, 0], [50, 0.25], [70, 0.55], [85, 0.8]]);
const thunderSeverity = (value) => stepSeverity(value, [[10, 0], [25, 0.25], [50, 0.6], [70, 0.85]], 0);
const gustSeverity = (value) => stepSeverity(value, [[35, 0], [50, 0.25], [65, 0.55], [80, 0.8]]);

function temperatureSeverity(value) {
  if (value == null || Number.isNaN(value)) return 0.35;
  if (value >= 12 && value <= 28) return 0;
  if ((value >= 8 && value < 12) || (value > 28 && value <= 31)) return 0.25;
  if ((value >= 4 && value < 8) || (value > 31 && value <= 34)) return 0.6;
  return 1;
}

function aggregate(values, fallback = 0.45) {
  const usable = values.filter((value) => value != null && !Number.isNaN(value));
  if (!usable.length) return fallback;
  const average = usable.reduce((sum, value) => sum + value, 0) / usable.length;
  return 0.6 * average + 0.4 * Math.max(...usable);
}

function longestDryRun(hours) {
  let longest = 0;
  let current = 0;
  for (const hour of hours) {
    const dry = hour.precipitation < 0.2
      && (hour.precipProbability ?? 50) < 50
      && (hour.thunderProbability ?? 0) < 15;
    current = dry ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

function dryWindowPenalty(longest, duration) {
  const ratio = duration ? longest / duration : 0;
  if (ratio >= 0.8) return 0;
  if (ratio >= 0.6) return 0.3;
  if (ratio >= 0.4) return 0.7;
  return 1;
}

function agreementForHour(classes = []) {
  if (classes.length < 2) return 0.5;
  const counts = new Map();
  classes.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return Math.max(...counts.values()) / classes.length;
}

function labelForScore(score) {
  if (score >= 86) return "JEDŹ";
  if (score >= 70) return "RACZEJ JEDŹ";
  if (score >= 45) return "TYLKO WARUNKOWO";
  return "NIE JEDŹ";
}

function headlineFor(score, startHour) {
  if (score >= 70 && startHour <= 12) return "Jedź rano.";
  if (score >= 70) return "Raczej jedź.";
  if (score >= 45) return "Jedź z planem B.";
  return "Lepiej odpuść.";
}

export function evaluateWindow(hours, options = {}) {
  const rain = aggregate(hours.map((hour) => rainSeverity(hour.precipitation)));
  const probability = aggregate(hours.map((hour) => probabilitySeverity(hour.precipProbability)));
  const thunder = aggregate(hours.map((hour) => thunderSeverity(hour.thunderProbability)), 0);
  const gust = aggregate(hours.map((hour) => gustSeverity(hour.gust)));
  const temperature = aggregate(hours.map((hour) => temperatureSeverity(hour.temperature)));
  const longestDry = longestDryRun(hours);
  const dryPenalty = dryWindowPenalty(longestDry, hours.length);
  const agreement = hours.reduce((sum, hour) => sum + agreementForHour(hour.providerClasses), 0) / Math.max(1, hours.length);
  const agreementPenalty = agreement >= 0.8 ? 0 : agreement >= 0.6 ? 0.5 : 1;

  const penalties = {
    rain: 30 * rain,
    probability: 10 * probability,
    thunder: 25 * thunder,
    gust: 15 * gust,
    temperature: 5 * temperature,
    dryWindow: 10 * dryPenalty,
    agreement: 5 * agreementPenalty,
  };

  let score = Math.round(100 - Object.values(penalties).reduce((sum, value) => sum + value, 0));
  const rainTotal = hours.reduce((sum, hour) => sum + (hour.precipitation || 0), 0);
  const maxRain = Math.max(...hours.map((hour) => hour.precipitation || 0));
  const maxThunder = Math.max(...hours.map((hour) => hour.thunderProbability || 0));
  const maxGust = Math.max(...hours.map((hour) => hour.gust || 0));
  const minTemp = Math.min(...hours.map((hour) => hour.temperature ?? 99));
  const maxTemp = Math.max(...hours.map((hour) => hour.temperature ?? -99));
  const cloudValues = hours.map((hour) => hour.cloudCover).filter(Number.isFinite);
  const averageCloudCover = cloudValues.length
    ? cloudValues.reduce((sum, value) => sum + value, 0) / cloudValues.length
    : null;

  if (maxThunder >= 70) score = Math.min(score, 29);
  if (hours.filter((hour) => (hour.thunderProbability || 0) >= 50).length >= 2) score = Math.min(score, 39);
  if (maxThunder >= 30) score = Math.min(score, 69);
  if (hours.filter((hour) => (hour.precipitation || 0) >= 3).length >= 2 || rainTotal >= 8) score = Math.min(score, 39);
  if (hours.filter((hour) => (hour.precipitation || 0) >= 1.5).length >= Math.ceil(hours.length / 2)) score = Math.min(score, 44);
  if (maxGust >= 80) score = Math.min(score, 24);
  if (hours.filter((hour) => (hour.gust || 0) >= 65).length >= 2) score = Math.min(score, 44);
  if (hours.filter((hour) => (hour.temperature ?? 20) < 4 || (hour.temperature ?? 20) > 34).length >= Math.ceil(hours.length / 2)) score = Math.min(score, 69);

  let confidence = options.icmAvailable && options.numericSourceCount >= 3
    ? "wysoka"
    : options.icmAvailable && options.numericSourceCount >= 2 ? "średnia" : "niska";
  if (confidence === "średnia") score = Math.min(score, 85);
  if (confidence === "niska") score = Math.min(score, 69);

  let antistormStatus = "zielony";
  let overrideLabel = null;
  if (options.applyAntistorm && options.antistorm) {
    const stormProbability = Number(options.antistorm.p_b) || 0;
    const rainProbability = Number(options.antistorm.p_o) || 0;
    const stormEta = Number(options.antistorm.t_b);
    const rainEta = Number(options.antistorm.t_o);
    const stormEtaKnown = Number.isFinite(stormEta) && stormEta >= 0 && stormEta < 255;
    const rainEtaKnown = Number.isFinite(rainEta) && rainEta >= 0 && rainEta < 255;

    if (stormProbability >= 70 && stormEtaKnown && stormEta <= 60) {
      antistormStatus = "czerwony";
      score = Math.min(score, 15);
      overrideLabel = "NIE JEDŹ TERAZ — BURZA BLISKO";
    } else if (
      (stormProbability >= 30 && stormEtaKnown && stormEta <= 120)
      || (stormProbability >= 70 && !stormEtaKnown)
      || (rainProbability >= 60 && rainEtaKnown && rainEta <= 120)
    ) {
      antistormStatus = "żółty";
      score = Math.min(score, 44);
      overrideLabel = "WSTRZYMAJ DECYZJĘ — SPRAWDŹ ZA 15 MIN";
    }
  }

  score = clamp(score, 0, 100);
  const startHour = hours[0]?.hour ?? 10;
  const endHour = (hours.at(-1)?.hour ?? startHour) + 1;
  const reasons = [];

  if (longestDry >= 3) reasons.push(`${longestDry} h bez istotnego deszczu`);
  if (rainTotal >= 0.2) reasons.push(`Możliwy opad: ${rainTotal.toFixed(1).replace(".", ",")} mm`);
  if (maxGust >= 35) reasons.push(`Porywy do ${Math.round(maxGust)} km/h`);
  if (agreement < 0.6) reasons.push("Prognozy wyraźnie się różnią");
  if (!options.icmAvailable) reasons.push("ICM chwilowo niedostępny");
  if (!reasons.length) reasons.push("Modele nie pokazują istotnych zagrożeń");

  return {
    score,
    label: overrideLabel || labelForScore(score),
    headline: overrideLabel ? (score <= 15 ? "Nie jedź teraz." : "Poczekaj chwilę.") : headlineFor(score, startHour),
    confidence,
    bestWindow: { start: startHour, end: endHour },
    reasons: reasons.slice(0, 3),
    antistormStatus,
    metrics: { rainTotal, maxRain, maxThunder, maxGust, minTemp, maxTemp, averageCloudCover, longestDry, agreement },
    penalties,
    hours,
  };
}

export function chooseRecommendation(hours, options = {}) {
  const parkOpen = options.parkOpen ?? 10;
  const parkClose = options.parkClose ?? 20;
  const visitHours = options.visitHours ?? 5;
  const earliestStart = Math.max(parkOpen, options.earliestStart ?? parkOpen);
  const available = hours.filter((hour) => hour.hour >= earliestStart && hour.hour < parkClose);

  if (available.length < 3) {
    const isTooLate = earliestStart > parkOpen;
    return {
      score: null,
      label: isTooLate ? "ZA PÓŹNO" : "BRAK DANYCH",
      headline: isTooLate ? "Na dziś już za późno." : "Sprawdź ponownie.",
      confidence: "niska",
      bestWindow: null,
      reasons: [isTooLate
        ? "Do zamknięcia zostało mniej niż 3 h"
        : "Za mało danych godzinowych do uczciwej oceny"],
      antistormStatus: "brak",
      metrics: null,
      hours: available,
    };
  }

  const candidates = [];
  for (let index = 0; index <= available.length - visitHours; index += 1) {
    const window = available.slice(index, index + visitHours);
    if (window.at(-1).hour - window[0].hour !== visitHours - 1) continue;
    candidates.push(evaluateWindow(window, options));
  }

  if (!candidates.length) {
    const window = available.slice(0, Math.min(available.length, visitHours));
    const result = evaluateWindow(window, options);
    if (window.length < visitHours) {
      result.score = Math.min(result.score, 69);
      result.label = labelForScore(result.score);
      result.headline = "Jedź tylko na chwilę.";
      result.reasons = ["Mało czasu w parku", ...result.reasons].slice(0, 3);
    }
    return result;
  }

  return candidates.sort((a, b) => b.score - a.score || a.bestWindow.start - b.bestWindow.start)[0];
}

export function classifyProviderForecast({ precipitation = 0, precipProbability = null, thunder = false }) {
  if (thunder || precipitation >= 3 || precipProbability >= 85) return 3;
  if (precipitation >= 1 || precipProbability >= 70) return 2;
  if (precipitation >= 0.1 || precipProbability >= 30) return 1;
  return 0;
}
