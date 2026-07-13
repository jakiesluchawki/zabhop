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

function userPosition(position) {
  const source = position?.coords ?? position;
  if (!source) return null;
  const lat = Number(source.latitude ?? source.lat);
  const lon = Number(source.longitude ?? source.lon ?? source.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const accuracy = Number(source.accuracy);
  return {
    point: [lat, lon],
    accuracy: Number.isFinite(accuracy) ? Math.max(1, Math.min(1000, accuracy)) : null,
  };
}

function splitKey(item, index) {
  const match = String(item.sequence ?? "").match(/^(.+?)[A-Za-z]$/);
  return match ? match[1] : `split-${index}`;
}

export function routeGeometry(items, completed) {
  const activeItems = items.filter((item) => !completed.has(item.id));
  const primary = [];
  const branches = [];
  for (let index = 0; index < items.length;) {
    const item = items[index];
    if (item.markerKind !== "split") {
      if (!completed.has(item.id)) {
        const point = coordinates(item);
        if (point) primary.push(point);
      }
      index += 1;
      continue;
    }

    const key = splitKey(item, index);
    const group = [];
    while (index < items.length && items[index].markerKind === "split" && splitKey(items[index], index) === key) {
      group.push(items[index]);
      index += 1;
    }
    const activeGroup = group.filter((entry) => !completed.has(entry.id));
    if (activeGroup.length === 0) continue;

    const anchor = primary.at(-1) ?? null;
    // A pozostaje punktem spotkania nawet po zaliczeniu tej odnogi. Grupowanie
    // po pełnym planie zapobiega awansowaniu B na punkt spotkania po ukryciu A.
    const reunion = coordinates(group[0]) ?? coordinates(activeGroup[0]);
    if (!reunion) continue;
    primary.push(reunion);
    // Pierwsza odnoga prowadzi do miejsca spotkania. Druga jest osobną
    // ścieżką równoległą: od wspólnego punktu, przez atrakcję B, do A.
    group.slice(1).filter((entry) => !completed.has(entry.id)).forEach((entry) => {
      const branchPoint = coordinates(entry);
      if (!branchPoint) return;
      branches.push([anchor, branchPoint, reunion].filter(Boolean));
    });
  }
  return { activeItems, primary, branches };
}

export function PlannerMap({
  items = [],
  toilets = [],
  completedIds = [],
  selectedId = null,
  showToilets = false,
  position = null,
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
      attributionControl: false,
    });
    L.control.attribution({ prefix: false }).addTo(map);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: 'Dane mapy &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    L.control.zoom({
      position: "topright",
      zoomInTitle: "Przybliż mapę",
      zoomOutTitle: "Oddal mapę",
    }).addTo(map);
    const container = map.getContainer();
    container.setAttribute("lang", "pl");
    container.setAttribute("role", "region");
    container.setAttribute("aria-label", "Interaktywna mapa planu Energylandii");
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
    const { activeItems, primary, branches } = routeGeometry(items, completed);
    if (primary.length > 1) {
      L.polyline(primary, {
        color: "#7442d9",
        weight: 4,
        opacity: 0.56,
        dashArray: "5 8",
        lineCap: "round",
      }).addTo(layer);
    }
    branches.filter((points) => points.length > 1).forEach((points) => {
      L.polyline(points, {
        color: "#7442d9",
        weight: 3,
        opacity: 0.72,
        dashArray: "2 7",
        lineCap: "round",
      }).addTo(layer);
    });

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
        element.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
          event.preventDefault();
          event.stopPropagation();
          onSelect?.(item);
        });
      }
    });

    if (showToilets) {
      toilets.forEach((toilet) => {
        const point = coordinates(toilet);
        if (!point) return;
        const toiletName = toilet.name || "Toaleta";
        const toiletMarker = L.circleMarker(point, {
          radius: 7,
          color: "#fff8f0",
          weight: 3,
          fillColor: "#6d6435",
          fillOpacity: 1,
        }).bindTooltip(`${toiletName} · WC`, { direction: "top" }).addTo(layer);
        const element = toiletMarker.getElement();
        if (element) {
          element.setAttribute("tabindex", "0");
          element.setAttribute("focusable", "true");
          element.setAttribute("role", "img");
          element.setAttribute("aria-label", `${toiletName}. Toaleta.`);
          element.addEventListener("focus", () => toiletMarker.openTooltip());
          element.addEventListener("blur", () => toiletMarker.closeTooltip());
        }
      });
    }

    const located = userPosition(position);
    if (located) {
      if (located.accuracy) {
        L.circle(located.point, {
          radius: located.accuracy,
          color: "#5b43d6",
          weight: 1,
          opacity: 0.55,
          fillColor: "#8b75ef",
          fillOpacity: 0.12,
          interactive: false,
        }).addTo(layer);
      }
      const userMarker = L.circleMarker(located.point, {
        radius: 9,
        color: "#fff8f0",
        weight: 4,
        fillColor: "#5b43d6",
        fillOpacity: 1,
      }).bindTooltip("Jesteście tutaj", { direction: "top" }).addTo(layer);
      const element = userMarker.getElement();
      if (element) {
        element.setAttribute("tabindex", "0");
        element.setAttribute("focusable", "true");
        element.setAttribute("role", "img");
        element.setAttribute("aria-label", "Jesteście tutaj. Aktualna lokalizacja na mapie.");
        element.addEventListener("focus", () => userMarker.openTooltip());
        element.addEventListener("blur", () => userMarker.closeTooltip());
      }
      userMarker.bringToFront();
    }
  }, [items, toilets, completedIds, selectedId, showToilets, position, onSelect]);

  return <div ref={elementRef} className="planner-map" role="region" lang="pl" aria-label="Interaktywna mapa planu Energylandii" />;
}
