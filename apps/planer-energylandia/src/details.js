import { detailsForAttraction as baseDetailsForAttraction } from "./attractionDetails.js";

export function detailsForAttraction(attraction) {
  if (attraction?.imageUrl || attraction?.summary) {
    return {
      imageUrl: attraction.imageUrl ?? null,
      summary: attraction.summary ?? "Sprawdź ograniczenia i komunikaty obsługi przed wejściem.",
    };
  }
  return baseDetailsForAttraction(attraction);
}
