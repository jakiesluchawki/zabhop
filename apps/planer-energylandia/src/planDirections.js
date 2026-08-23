import { ALL_ATTRACTIONS_BY_ID, RESTAURANTS } from "./extendedData.js";
import { approximateWalkingMinutes, distanceMeters, formatDistance } from "./appUtils.js";
import { zoneLabel } from "./planner.js";

const RESTAURANTS_BY_ID = Object.freeze(Object.fromEntries(
  RESTAURANTS.map((restaurant) => [restaurant.id, restaurant]),
));

function directionLeg(from, destination) {
  if (!destination) return null;
  const destinationZone = zoneLabel(destination.zone);

  if (!from) {
    return {
      fromLabel: "wejścia lub bieżącej pozycji",
      destination,
      meters: null,
      minutes: null,
      copy: `Pierwszy punkt · kierujcie się do ${destinationZone}`,
    };
  }

  const distance = distanceMeters(from, destination);
  if (!Number.isFinite(distance) || distance < 0) {
    return {
      fromLabel: from.name || "poprzedniego punktu",
      destination,
      meters: null,
      minutes: null,
      copy: `Z ${from.name || "poprzedniego punktu"}: kierujcie się do ${destinationZone}`,
    };
  }

  const meters = Math.round(distance);
  const minutes = approximateWalkingMinutes(meters);
  const zoneDirection = from.zone === destination.zone
    ? `zostańcie w strefie ${destinationZone}`
    : `kierujcie się do ${destinationZone}`;

  return {
    fromLabel: from.name || "poprzedniego punktu",
    destination,
    meters,
    minutes,
    copy: `Z ${from.name || "poprzedniego punktu"}: ${zoneDirection} · ${formatDistance(meters)} · około ${minutes} min`,
  };
}

function showDirection(from, step) {
  if (step?.location) {
    const destination = {
      ...step.location,
      name: step.title || step.name || "pokaz",
      zone: step.zone || from?.zone || "family-zone",
    };
    return directionLeg(from, destination);
  }

  const venue = String(step?.venue || step?.venueName || "").trim();
  if (!venue) return null;

  return {
    fromLabel: from?.name || "poprzedniego punktu",
    destination: { name: step.title || step.name || "pokaz", zone: step.zone || from?.zone || "family-zone" },
    meters: null,
    minutes: null,
    copy: `Pokaz odbywa się w ${venue}; sprawdźcie dojście na miejscu.`,
  };
}

export function directionsForDay(day) {
  let previous = null;
  const directions = {};

  for (const step of day?.steps || []) {
    if (step?.kind === "ride") {
      const attraction = ALL_ATTRACTIONS_BY_ID[step.attractionId];
      const leg = directionLeg(previous, attraction);
      if (leg) directions[step.id] = leg;
      if (attraction) previous = attraction;
      continue;
    }

    if (step?.kind === "split") {
      const assignments = Array.isArray(step.assignments) ? step.assignments : [];
      assignments.forEach((assignment, index) => {
        const attraction = ALL_ATTRACTIONS_BY_ID[assignment.attractionId];
        const leg = directionLeg(previous, attraction);
        if (leg) directions[`${step.id}:${index}`] = leg;
      });
      const reunion = ALL_ATTRACTIONS_BY_ID[assignments[0]?.attractionId];
      if (reunion) previous = reunion;
      continue;
    }

    if (step?.kind === "meal") {
      const restaurant = RESTAURANTS_BY_ID[step.restaurantId];
      const leg = directionLeg(previous, restaurant);
      if (leg) directions[step.id] = leg;
      if (restaurant) previous = restaurant;
      continue;
    }

    if (step?.kind === "show") {
      const leg = showDirection(previous, step);
      if (leg) directions[step.id] = leg;
      if (step.location && leg?.destination) previous = leg.destination;
    }
  }

  return directions;
}
