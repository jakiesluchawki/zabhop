export const TICKET_SOURCE_URL = "https://energylandia.pl/cennik/bilety-indywidualne/bilety-elektroniczne/";

const PRICE_TABLE = {
  low: {
    seasonLabel: "sezon niski 2026",
    standard: { oneDay: 209, twoDay: 379 },
    discounted: { oneDay: 169, twoDay: 309 },
  },
  high: {
    seasonLabel: "sezon wysoki 2026",
    standard: { oneDay: 229, twoDay: 419 },
    discounted: { oneDay: 189, twoDay: 349 },
  },
};

function monthDay(dayKey) {
  return Number(dayKey.slice(5).replace("-", ""));
}

export function ticketPricesFor(dayKey) {
  if (!dayKey.startsWith("2026-")) return null;
  const value = monthDay(dayKey);
  if ((value >= 416 && value <= 626) || (value >= 901 && value <= 1031)) {
    return PRICE_TABLE.low;
  }
  if (value >= 627 && value <= 831) return PRICE_TABLE.high;
  return null;
}

export function calculateTicketCost(prices, party = {}) {
  if (!prices) return null;
  const standard = Math.max(0, Number(party.standard) || 0);
  const discounted = Math.max(0, Number(party.discounted) || 0);
  const oneDay = standard * prices.standard.oneDay + discounted * prices.discounted.oneDay;
  const twoDay = standard * prices.standard.twoDay + discounted * prices.discounted.twoDay;
  const twoSingles = oneDay * 2;
  return {
    people: standard + discounted,
    oneDay,
    twoDay,
    twoDayPerDay: twoDay / 2,
    secondDayExtra: twoDay - oneDay,
    savings: twoSingles - twoDay,
    savingsPercent: twoSingles ? Math.round(((twoSingles - twoDay) / twoSingles) * 100) : 0,
  };
}

export function compareVisitLengths(dayOne, dayTwo, prices, party = { standard: 1, discounted: 0 }) {
  const costs = calculateTicketCost(prices, party);
  const firstScore = dayOne?.score;
  const secondScore = dayTwo?.score;

  if (!Number.isFinite(firstScore) || !Number.isFinite(secondScore)) {
    return {
      mode: "one",
      headline: "Na razie planuj 1 dzień.",
      detail: "Drugi dzień nie ma jeszcze wystarczająco pewnej prognozy.",
      costs,
    };
  }

  const average = (firstScore + secondScore) / 2;
  const weaker = Math.min(firstScore, secondScore);
  const betterDay = firstScore >= secondScore ? 1 : 2;

  if (weaker >= 70) {
    return {
      mode: "two",
      headline: "Bierz 2 dni.",
      detail: "Oba dni wyglądają dobrze, a drugi dzień kosztuje mniej niż osobny bilet.",
      costs,
    };
  }

  if (weaker >= 55 && average >= 68) {
    return {
      mode: "two",
      headline: "2 dni mają sens.",
      detail: "Pogoda daje dwa użyteczne dni; dłuższy bilet poprawia koszt dnia.",
      costs,
    };
  }

  if (Math.max(firstScore, secondScore) >= 65 && weaker < 50) {
    return {
      mode: "one",
      headline: `Wybierz ${betterDay === 1 ? "pierwszy" : "drugi"} dzień.`,
      detail: "Nie dopłacaj za drugi dzień przy wyraźnie słabszej pogodzie.",
      costs,
      betterDay,
    };
  }

  if (average < 45) {
    return {
      mode: "wait",
      headline: "Nie kupuj jeszcze 2 dni.",
      detail: "Oba dni są zbyt ryzykowne pogodowo, żeby rabat uzasadniał zakup.",
      costs,
    };
  }

  return {
    mode: "one",
    headline: "Zacznij od 1 dnia.",
    detail: "Oszczędność na bilecie dwudniowym jest mała wobec niepewnej drugiej doby.",
    costs,
    betterDay,
  };
}

export function getDialCondition(recommendation) {
  const metrics = recommendation?.metrics;
  if (!metrics) return "cloud";
  const maxProbability = Math.max(0, ...(recommendation.hours || []).map((hour) => hour.precipProbability || 0));
  if (metrics.maxThunder >= 25 || metrics.rainTotal >= 0.6 || metrics.maxRain >= 0.35 || maxProbability >= 70) {
    return "rain";
  }
  if ((metrics.averageCloudCover ?? 50) >= 55 || metrics.rainTotal >= 0.1 || maxProbability >= 35) {
    return "cloud";
  }
  return "sun";
}
