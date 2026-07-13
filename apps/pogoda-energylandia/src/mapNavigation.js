const APPLE_MAPS_DIRECTIONS_URL = "https://maps.apple.com/";
const GOOGLE_MAPS_DIRECTIONS_URL = "https://www.google.com/maps/dir/";

function finiteCoordinate(value) {
  if (value === null || value === undefined || value === "") return null;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
}

function destinationFor(attraction) {
  const location = attraction?.location;
  if (!location || typeof location !== "object") return null;

  const lat = finiteCoordinate(location.lat);
  const lon = finiteCoordinate(location.lon ?? location.lng);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  return { lat, lon };
}

export function createWalkingMapLinks(attraction) {
  const destination = destinationFor(attraction);
  if (!destination) return null;

  const destinationName = String(attraction?.name ?? "Atrakcja Energylandii").trim()
    || "Atrakcja Energylandii";
  const coordinates = `${destination.lat},${destination.lon}`;

  const appleMaps = new URL(APPLE_MAPS_DIRECTIONS_URL);
  appleMaps.searchParams.set("daddr", coordinates);
  appleMaps.searchParams.set("q", destinationName);
  appleMaps.searchParams.set("dirflg", "w");

  const googleMaps = new URL(GOOGLE_MAPS_DIRECTIONS_URL);
  googleMaps.searchParams.set("api", "1");
  googleMaps.searchParams.set("destination", coordinates);
  googleMaps.searchParams.set("travelmode", "walking");

  return {
    destinationName,
    appleMapsUrl: appleMaps.toString(),
    googleMapsUrl: googleMaps.toString(),
  };
}
