import {
  ATTRACTIONS as BASE_ATTRACTIONS,
  OSM_SOURCE_URL,
  TOILETS,
  ZONES,
} from "./parkData.js";

const VERIFIED_AT = "2026-07-13";

const COASTERS = new Set([
  "honey-harbour",
  "choco-chip-creek",
  "abyssus",
  "light-explorers",
  "frida",
  "formula",
  "rmf-dragon",
  "boomerang",
  "energus",
]);

const SPINNING = new Set(["candy-carousel", "stormy-ship", "wonder-wheel"]);
const SCENIC = new Set(["wonder-wheel", "grotto-expedition"]);

function accessRulesFrom(restrictions = {}) {
  const rules = [];
  if (restrictions.minHeightWithGuardian != null || restrictions.minAgeWithGuardian != null) {
    rules.push(Object.freeze({
      mode: "withGuardian",
      minHeightCm: restrictions.minHeightWithGuardian ?? null,
      maxHeightCm: restrictions.maxHeight ?? null,
      minAgeYears: restrictions.minAgeWithGuardian ?? null,
      maxAgeYears: restrictions.maxAgeWithGuardian ?? null,
      maxDependentsPerGuardian: 1,
    }));
  }
  if (restrictions.soloHeight != null) {
    rules.push(Object.freeze({
      mode: "solo",
      minHeightCm: restrictions.soloHeight,
      maxHeightCm: restrictions.maxHeight ?? null,
      minAgeYears: null,
      maxAgeYears: null,
    }));
  }
  if (rules.length === 0) rules.push(Object.freeze({ mode: "unrestricted" }));
  return Object.freeze(rules);
}

function tagsFor(attraction) {
  const tags = new Set(["ride"]);
  if (COASTERS.has(attraction.id)) tags.add("coaster");
  if (SPINNING.has(attraction.id)) tags.add("spinning");
  if (SCENIC.has(attraction.id)) tags.add("scenic");
  if (attraction.wet) tags.add("water");
  if (attraction.indoor) tags.add("indoor");
  if (attraction.toddlerLike || attraction.maxAgeWithGuardian != null) tags.add("little-kids");
  if (attraction.intensity === "calm") tags.add("calm");
  if (attraction.intensity === "medium") tags.add("family");
  if (attraction.intensity === "high") tags.add("thrill");
  return Object.freeze([...tags]);
}

function thrillLevelFor(attraction) {
  if (attraction.toddlerLike) return 1;
  if (attraction.id === "choco-chip-creek") return 3;
  if (attraction.intensity === "high") return 4;
  if (attraction.intensity === "medium") return 2;
  return 1;
}

function enrichBaseAttraction(attraction) {
  return Object.freeze({
    ...attraction,
    officialNumber: null,
    thrillLevel: thrillLevelFor(attraction),
    tags: tagsFor(attraction),
    accessRules: accessRulesFrom(attraction.restrictions),
    verifiedAt: VERIFIED_AT,
  });
}

function extraAttraction({ restrictions, tags, ...attraction }) {
  const normalizedRestrictions = Object.freeze({
    minHeightWithGuardian: null,
    minAgeWithGuardian: null,
    maxAgeWithGuardian: null,
    soloHeight: null,
    maxHeight: null,
    ...restrictions,
  });
  return Object.freeze({
    ...attraction,
    lat: attraction.location.lat,
    lon: attraction.location.lon,
    restrictions: normalizedRestrictions,
    ...normalizedRestrictions,
    tags: Object.freeze(tags),
    accessRules: accessRulesFrom(normalizedRestrictions),
    queueAliases: Object.freeze([attraction.name, ...(attraction.queueAliases ?? [])]),
    sources: Object.freeze({ restrictions: attraction.sourceUrl, coordinates: OSM_SOURCE_URL }),
    verifiedAt: VERIFIED_AT,
  });
}

export const EXTRA_ATTRACTIONS = Object.freeze([
  extraAttraction({
    id: "zadra",
    name: "Zadra",
    officialNumber: 154,
    zone: "dragon-zone",
    location: Object.freeze({ lat: 50.0020526, lon: 19.402749 }),
    restrictions: { minHeightWithGuardian: 140, soloHeight: 140 },
    minAge: null,
    routeOrder: 78,
    priority: 168,
    thrillLevel: 5,
    intensity: "extreme",
    tags: ["ride", "coaster", "thrill", "iconic"],
    wet: false,
    indoor: false,
    durationMinutes: 4,
    queueAliases: ["Zadra Rc"],
    sourceUrl: "https://energylandia.pl/atrakcje/smoczy-grod/zadra/",
    imageUrl: "https://energylandia.pl/wp-content/uploads/2019/08/SMOCZY-GROD-21.jpg",
    summary: "Hybrydowy rollercoaster o wysokości ponad 63 m i prędkości 121 km/h. Jeden z najmocniejszych punktów parku — wyłącznie od 140 cm.",
  }),
  extraAttraction({
    id: "mayan",
    name: "Mayan Zero Limitów",
    officialNumber: 43,
    zone: "extreme-zone",
    location: Object.freeze({ lat: 50.0018127, lon: 19.4056822 }),
    restrictions: { minHeightWithGuardian: 140, soloHeight: 140, maxHeight: 195 },
    routeOrder: 86,
    priority: 134,
    thrillLevel: 5,
    intensity: "extreme",
    tags: ["ride", "coaster", "thrill", "spinning"],
    wet: false,
    indoor: false,
    durationMinutes: 4,
    queueAliases: ["Mayan Rc", "Fast Pass Mayan Kol Licznik"],
    sourceUrl: "https://energylandia.pl/atrakcje/strefa-ekstremalna/mayan/",
    imageUrl: "https://energylandia.pl/wp-content/uploads/2017/02/STREFA-EKSTREMALNA-8.jpg",
    summary: "Podwieszany rollercoaster z pięcioma inwersjami. Mocna propozycja dla osób od 140 cm, które naprawdę lubią jazdę do góry nogami.",
  }),
  extraAttraction({
    id: "tsunami-drop",
    name: "Tsunami Drop",
    officialNumber: 44,
    zone: "extreme-zone",
    location: Object.freeze({ lat: 50.0015738, lon: 19.4064472 }),
    restrictions: { minHeightWithGuardian: 130, soloHeight: 130, maxHeight: 195 },
    routeOrder: 87,
    priority: 118,
    thrillLevel: 4,
    intensity: "high",
    tags: ["ride", "drop", "thrill", "scenic"],
    wet: false,
    indoor: false,
    durationMinutes: 3,
    queueAliases: ["Tsunami Drop", "Fastpass Tsunami Drop Licz"],
    sourceUrl: "https://energylandia.pl/atrakcje/strefa-ekstremalna/tsunami-dropper/",
    imageUrl: "https://energylandia.pl/wp-content/uploads/2017/02/Tsunami-Drop.jpg",
    summary: "Wieża swobodnego spadania dostępna od 130 cm. Krótka, widokowa i dużo mocniejsza, niż sugeruje sam czas przejazdu.",
  }),
  extraAttraction({
    id: "aztec-swing",
    name: "Aztec Swing",
    officialNumber: 47,
    zone: "extreme-zone",
    location: Object.freeze({ lat: 50.0010101, lon: 19.4059559 }),
    restrictions: { minHeightWithGuardian: 140, soloHeight: 140, maxHeight: 195 },
    routeOrder: 88,
    priority: 116,
    thrillLevel: 5,
    intensity: "extreme",
    tags: ["ride", "spinning", "thrill"],
    wet: false,
    indoor: false,
    durationMinutes: 4,
    queueAliases: ["Aztec Swing", "Fast Pass Aztecswing Licznik"],
    sourceUrl: "https://energylandia.pl/atrakcje/strefa-ekstremalna/aztec-swing/",
    imageUrl: "https://energylandia.pl/wp-content/uploads/2017/02/STREFA-EKSTREMALNA-14.jpg",
    summary: "Ogromne wahadło, które jednocześnie buja i obraca pasażerów. Dla grup szukających mocnych przeciążeń, od 140 cm.",
  }),
  extraAttraction({
    id: "viking",
    name: "Viking",
    officialNumber: 45,
    zone: "extreme-zone",
    location: Object.freeze({ lat: 50.0015529, lon: 19.4069911 }),
    restrictions: { minHeightWithGuardian: 140, soloHeight: 140, maxHeight: 195 },
    minAge: 12,
    routeOrder: 89,
    priority: 106,
    thrillLevel: 4,
    intensity: "high",
    tags: ["ride", "coaster", "spinning", "thrill"],
    wet: false,
    indoor: false,
    durationMinutes: 4,
    queueAliases: ["Viking Rc", "Viking Ride"],
    sourceUrl: "https://energylandia.pl/atrakcje/strefa-ekstremalna/viking-roller-coaster/",
    imageUrl: "https://energylandia.pl/wp-content/uploads/2017/02/viking_2024_4-2048x1365.jpg",
    summary: "Wirujący rollercoaster dla osób od 140 cm i co najmniej 12 lat. Wagonik obraca się niezależnie od kierunku toru.",
  }),
  extraAttraction({
    id: "space-gun",
    name: "Space Gun",
    officialNumber: 48,
    zone: "extreme-zone",
    location: Object.freeze({ lat: 50.0000138, lon: 19.407957 }),
    restrictions: { minHeightWithGuardian: 140, soloHeight: 140, maxHeight: 195 },
    routeOrder: 91,
    priority: 108,
    thrillLevel: 5,
    intensity: "extreme",
    tags: ["ride", "spinning", "thrill"],
    wet: false,
    indoor: false,
    durationMinutes: 4,
    queueAliases: ["Space Gun"],
    sourceUrl: "https://energylandia.pl/atrakcje/strefa-ekstremalna/space-gun/",
    imageUrl: "https://energylandia.pl/wp-content/uploads/2017/02/STREFA-EKSTREMALNA.jpg",
    summary: "Dwuramienne urządzenie obracające pasażerów wysoko nad ziemią. Ekstremalna opcja dla osób 140–195 cm.",
  }),
  extraAttraction({
    id: "apocalypto",
    name: "Apocalypto",
    officialNumber: 46,
    zone: "extreme-zone",
    location: Object.freeze({ lat: 50.0010597, lon: 19.4069535 }),
    restrictions: { minHeightWithGuardian: 140, soloHeight: 140, maxHeight: 195 },
    routeOrder: 92,
    priority: 104,
    thrillLevel: 5,
    intensity: "extreme",
    tags: ["ride", "spinning", "thrill"],
    wet: false,
    indoor: false,
    durationMinutes: 4,
    queueAliases: ["Apocalypto"],
    sourceUrl: "https://energylandia.pl/atrakcje/strefa-ekstremalna/apocalipto/",
    imageUrl: "https://energylandia.pl/wp-content/uploads/2017/02/Apocalypto.jpg",
    summary: "Obrotowa ława na dwuramiennej konstrukcji. Zmienny kierunek przeciążeń i bardzo intensywny przejazd od 140 cm.",
  }),
  extraAttraction({
    id: "space-booster",
    name: "Space Booster",
    officialNumber: 49,
    zone: "extreme-zone",
    location: Object.freeze({ lat: 49.999642, lon: 19.4079676 }),
    restrictions: { minHeightWithGuardian: 140, soloHeight: 140, maxHeight: 195 },
    routeOrder: 93,
    priority: 122,
    thrillLevel: 5,
    intensity: "extreme",
    tags: ["ride", "spinning", "thrill", "scenic"],
    wet: false,
    indoor: false,
    durationMinutes: 4,
    queueAliases: ["Space Booster", "Fast Pass Spacebooster Licznik"],
    sourceUrl: "https://energylandia.pl/atrakcje/strefa-ekstremalna/space-booster/",
    imageUrl: "https://energylandia.pl/wp-content/uploads/2017/02/STREFA-EKSTREMALNA-7-1.jpg",
    summary: "Potężne ramię obracające gondole wysoko nad parkiem. Widok i przeciążenia dla osób od 140 cm.",
  }),
  extraAttraction({
    id: "speed",
    name: "Speed Water Coaster",
    officialNumber: 80,
    zone: "extreme-zone",
    location: Object.freeze({ lat: 49.9986301, lon: 19.4089959 }),
    restrictions: { minHeightWithGuardian: 140, soloHeight: 140, maxHeight: 195 },
    routeOrder: 148,
    priority: 154,
    thrillLevel: 5,
    intensity: "extreme",
    tags: ["ride", "coaster", "water", "thrill", "iconic"],
    wet: true,
    indoor: false,
    durationMinutes: 5,
    queueAliases: ["Speed Rc", "Fast Pass Speed Kol Licznik"],
    sourceUrl: "https://energylandia.pl/atrakcje/strefa-ekstremalna/water-coaster-speed/",
    imageUrl: "https://energylandia.pl/wp-content/uploads/2017/03/Speed.jpg",
    summary: "Water coaster o wysokości 60 m i prędkości 110 km/h. Łączy mocny rollercoaster z finałem, po którym można wyjść mokrym.",
  }),
  extraAttraction({
    id: "hyperion",
    name: "Pepsi Hyperion",
    officialNumber: 141,
    zone: "extreme-zone",
    location: Object.freeze({ lat: 50.0002258, lon: 19.4118243 }),
    restrictions: { minHeightWithGuardian: 140, soloHeight: 140, maxHeight: 195 },
    routeOrder: 156,
    priority: 176,
    thrillLevel: 5,
    intensity: "extreme",
    tags: ["ride", "coaster", "thrill", "iconic"],
    wet: false,
    indoor: false,
    durationMinutes: 4,
    queueAliases: ["Hyperion Rc", "PEPSI Hyperion"],
    sourceUrl: "https://energylandia.pl/atrakcje/strefa-ekstremalna/hyperion/",
    imageUrl: "https://energylandia.pl/wp-content/uploads/2018/03/Hyperion-4.jpg",
    summary: "Najwyższy i najszybszy rollercoaster parku: 77 m wysokości, 142 km/h i pierwszy spadek pod kątem 85°. Tylko 140–195 cm.",
  }),
]);

export const ALL_ATTRACTIONS = Object.freeze([
  ...BASE_ATTRACTIONS.map(enrichBaseAttraction),
  ...EXTRA_ATTRACTIONS,
]);

export const ALL_ATTRACTIONS_BY_ID = Object.freeze(
  Object.fromEntries(ALL_ATTRACTIONS.map((attraction) => [attraction.id, attraction])),
);

export const RESTAURANTS = Object.freeze([
  Object.freeze({
    id: "napoli",
    name: "Napoli",
    zone: "dragon-zone",
    location: Object.freeze({ lat: 50.0017824, lon: 19.4013874 }),
    kind: "fast",
    durationMinutes: 30,
    description: "Pizza i szybki odpoczynek blisko Aqualantis i Smoczego Grodu.",
    dietary: ["pizza"],
    sourceUrl: OSM_SOURCE_URL,
  }),
  Object.freeze({
    id: "formula-restaurant",
    name: "Formuła Restaurant",
    zone: "extreme-zone",
    location: Object.freeze({ lat: 50.0002089, lon: 19.4052453 }),
    kind: "sit-down",
    durationMinutes: 55,
    description: "Włoska i regionalna kuchnia, miejsca wewnątrz i na zewnątrz, opcje wegetariańskie.",
    dietary: ["vegetarian", "italian", "regional"],
    sourceUrl: OSM_SOURCE_URL,
  }),
  Object.freeze({
    id: "formula-pizza",
    name: "Formula Pizza",
    zone: "extreme-zone",
    location: Object.freeze({ lat: 50.0003096, lon: 19.4052735 }),
    kind: "fast",
    durationMinutes: 30,
    description: "Szybka pizza przy Formule, z miejscami wewnątrz i na zewnątrz.",
    dietary: ["pizza"],
    sourceUrl: OSM_SOURCE_URL,
  }),
  Object.freeze({
    id: "scandinavia",
    name: "Scandinavia",
    zone: "family-zone",
    location: Object.freeze({ lat: 49.9999301, lon: 19.4094758 }),
    kind: "sit-down",
    durationMinutes: 55,
    description: "Większa restauracja z toaletą na granicy Strefy Familijnej i Bajkolandii.",
    dietary: [],
    sourceUrl: "https://energylandia.pl/gastronomia/scandinavia/",
  }),
]);

export { OSM_SOURCE_URL, TOILETS, VERIFIED_AT, ZONES };
