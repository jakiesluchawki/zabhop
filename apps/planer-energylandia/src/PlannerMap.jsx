import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const PARK_CENTER = [50.00015, 19.4067];
const PARK_BOUNDS = L.latLngBounds([49.9966, 19.3985], [50.0028, 19.4157]);

function coordinates(item) {
  const location = item?.location || item;
  if (!location) return null;
  const lat = Number(location.lat);
  const lon = Number(location.lon ?? location.lng);
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
}

export function PlannerMap({
  items = [],
  toilets = [],
  completedIds = [],
  selectedId = null,
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
      minZoom: 14,
      maxZoom: 19,
      maxBounds: PARK_BOUNDS.pad(0.35),
      zoomControl: false,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    L.control.zoom({ position: "topright" }).addTo(map);
    map.fitBounds(PARK_BOUNDS, { padding: [8, 8] });
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
    const completed = new Set(completedIds);
    const activeItems = items.filter((item) => !completed.has(item.id));
    const linePoints = activeItems.map(coordinates).filter(Boolean);
    if (linePoints.length > 1) {
      L.polyline(linePoints, {
        color: "#7442d9",
        weight: 4,
        opacity: 0.56,
        dashArray: "5 8",
        lineCap: "round",
      }).addTo(layer);
    }

    activeItems.forEach((item, index) => {
      const point = coordinates(item);
      if (!point) return;
      const sequence = item.sequence ?? index + 1;
      const selected = item.id === selectedId;
      const kind = item.markerKind === "split" ? "split" : "together";
      const size = selected ? 44 : 40;
      const accessibleName = `${sequence}. ${item.name}. ${kind === "split" ? "Podział grupy" : "Wszyscy razem"}. Otwórz szczegóły.`;
      const icon = L.divIcon({
        className: `planner-marker planner-marker--${kind}${selected ? " planner-marker--selected" : ""}`,
        html: `<span aria-hidden="true">${sequence}</span>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      const marker = L.marker(point, {
        icon,
        keyboard: true,
        title: accessibleName,
        alt: accessibleName,
        riseOnHover: true,
        zIndexOffset: selected ? 1000 : kind === "split" ? 200 : 100,
      }).addTo(layer);
      marker.bindTooltip(`${sequence}. ${item.name}`, { direction: "top" });
      marker.on("click", () => onSelect?.(item));
      const element = marker.getElement();
      if (element) {
        element.setAttribute("role", "button");
        element.setAttribute("aria-label", accessibleName);
        element.setAttribute("aria-haspopup", "dialog");
      }
    });

    if (showToilets) {
      toilets.forEach((toilet) => {
        const point = coordinates(toilet);
        if (!point) return;
        L.circleMarker(point, {
          radius: 7,
          color: "#fff8f0",
          weight: 3,
          fillColor: "#6d6435",
          fillOpacity: 1,
        }).bindTooltip(toilet.name, { direction: "top" }).addTo(layer);
      });
    }
  }, [items, toilets, completedIds, selectedId, showToilets, onSelect]);

  return <div ref={elementRef} className="planner-map" aria-label="Mapa planu Energylandii" />;
}
