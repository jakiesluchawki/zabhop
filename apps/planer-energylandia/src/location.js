export const QUICK_LOCATION_OPTIONS = Object.freeze({
  // A cached or network-based first fix makes the distance useful on iOS even
  // before its high-accuracy GPS has settled.
  enableHighAccuracy: false,
  maximumAge: 60_000,
  timeout: 10_000,
});

export const TRACKING_LOCATION_OPTIONS = Object.freeze({
  enableHighAccuracy: true,
  maximumAge: 15_000,
  timeout: 25_000,
});

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function positionFromCoordinates(coords) {
  const lat = finite(coords?.latitude);
  const lon = finite(coords?.longitude);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const accuracy = finite(coords?.accuracy);
  return {
    lat,
    lon,
    accuracy: accuracy !== null && accuracy >= 0 ? accuracy : null,
  };
}

export function geolocationFailureStatus(error) {
  switch (Number(error?.code)) {
    case 1: return "denied";
    case 3: return "timeout";
    default: return "error";
  }
}
