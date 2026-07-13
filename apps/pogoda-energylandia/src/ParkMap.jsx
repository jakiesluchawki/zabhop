import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const PARK_CENTER = [50.00025, 19.4058];
const PARK_BOUNDS = L.latLngBounds([49.9967, 19.3987], [50.0027, 19.4125]);

function coordinates(item) {
  const location = item?.location || item;
  if (!location) return null;
  const lat = Number(location.lat);
  const lng = Number(location.lng ?? location.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

export function ParkMap({
  attractions = [],
  toilets = [],
  position = null,
  selectedId = null,
  focus = null,
  showToilets = false,
  onSelect,
}) {
  const elementRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef(null);

  useEffect(() => {
    if (!elementRef.current || mapRef.current) return undefined;
    const map = L.map(elementRef.current, {
      center: PARK_CENTER,
      zoom: 16,
      minZoom: 15,
      maxZoom: 19,
      maxBounds: PARK_BOUNDS.pad(0.45),
      zoomControl: false,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    L.control.zoom({ position: "topright" }).addTo(map);
    map.fitBounds(PARK_BOUNDS, { padding: [10, 10] });
    layersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    window.setTimeout(() => map.invalidateSize(), 0);
    return () => {
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layersRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const routePoints = attractions
      .filter((attraction) => attraction.familyTier === "primary")
      .map(coordinates)
      .filter(Boolean);
    if (routePoints.length > 1) {
      L.polyline(routePoints, {
        color: "#7442d9",
        weight: 4,
        opacity: 0.58,
        dashArray: "4 8",
        lineCap: "round",
      }).addTo(layer);
    }

    attractions.forEach((attraction, index) => {
      const point = coordinates(attraction);
      if (!point) return;
      const selected = attraction.id === selectedId;
      const primary = attraction.familyTier === "primary";
      const sequence = Number.isFinite(attraction.sequence) ? attraction.sequence : index + 1;
      const size = selected ? 46 : 42;
      const tierClass = primary ? "primary" : "secondary";
      const accessibleName = `${sequence}. ${attraction.name}, ${
        primary ? "zielony priorytet od 120 cm" : "żółta opcja dodatkowa"
      }. Otwórz opis i nawigację.`;
      const icon = L.divIcon({
        className: [
          "park-map-number-marker",
          `park-map-number-marker--${tierClass}`,
          selected ? "park-map-number-marker--selected" : "",
        ]
          .filter(Boolean)
          .join(" "),
        html: `<span class="park-map-number-marker__number" aria-hidden="true">${sequence}</span>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        tooltipAnchor: [0, -(size / 2 + 3)],
      });
      const marker = L.marker(point, {
        icon,
        keyboard: true,
        title: accessibleName,
        alt: accessibleName,
        riseOnHover: true,
        zIndexOffset: selected ? 1000 : primary ? 100 : 0,
      }).addTo(layer);
      marker.bindTooltip(`${sequence}. ${attraction.name} · ${primary ? "zielony 120+" : "żółty opcjonalny"}`, {
        direction: "top",
      });
      marker.on("click", () => onSelect?.(attraction));

      const markerElement = marker.getElement();
      if (markerElement) {
        markerElement.setAttribute("role", "button");
        markerElement.setAttribute("aria-label", accessibleName);
        markerElement.setAttribute("aria-haspopup", "dialog");
        markerElement.setAttribute("data-attraction-id", attraction.id);
        L.DomEvent.on(markerElement, "keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          L.DomEvent.preventDefault(event);
          L.DomEvent.stopPropagation(event);
          onSelect?.(attraction);
        });
      }
    });

    if (showToilets) {
      toilets.forEach((toilet) => {
        const point = coordinates(toilet);
        if (!point) return;
        L.circleMarker(point, {
          radius: toilet.id === selectedId ? 10 : 7,
          color: "#fff7f1",
          weight: 3,
          fillColor: "#6d6435",
          fillOpacity: 1,
        })
          .bindTooltip(toilet.name || "Toaleta", { direction: "top", offset: [0, -8] })
          .addTo(layer);
      });
    }

    const userPoint = coordinates(position);
    if (userPoint) {
      if (Number.isFinite(position.accuracy)) {
        L.circle(userPoint, {
          radius: Math.min(position.accuracy, 120),
          color: "#7442d9",
          weight: 1,
          fillColor: "#7442d9",
          fillOpacity: 0.09,
        }).addTo(layer);
      }
      L.circleMarker(userPoint, {
        radius: 8,
        color: "#fff7f1",
        weight: 3,
        fillColor: "#7442d9",
        fillOpacity: 1,
      }).bindTooltip("Jesteście tutaj", { permanent: false, direction: "top" }).addTo(layer);
    }
  }, [attractions, toilets, position, selectedId, showToilets, onSelect]);

  useEffect(() => {
    const point = coordinates(focus);
    if (point && mapRef.current) mapRef.current.flyTo(point, 18, { duration: 0.65 });
  }, [focus]);

  return <div ref={elementRef} className="park-map" aria-label="Interaktywna mapa Energylandii" />;
}
