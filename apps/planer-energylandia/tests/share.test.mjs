import test from "node:test";
import assert from "node:assert/strict";
import { buildUniversalPlan } from "../src/planner.js";
import {
  createEmailDraftUrl,
  createShortPlanLink,
  decodePlan,
  encodeCompactPlan,
  encodePlan,
  hasShortPlanHash,
  loadShortPlan,
  sanitizeSharedPlan,
  shortPlanTokenFromHash,
} from "../src/share.js";

const profile = {
  dayCount: 2,
  visitStartDate: "2026-07-14",
  arrivalTime: "10:00",
  departureTime: "20:00",
  pace: "normal",
  splitPolicy: "worthwhile",
  members: [
    { id: "a1", role: "adult", name: "A", age: 35, height: 180 },
    { id: "a2", role: "adult", name: "B", age: 34, height: 170 },
    { id: "c1", role: "child", name: "C", age: 7, height: 122 },
  ],
  preferences: { intensity: "mixed", interests: ["coasters", "family"], wet: "ok", maxQueue: 45 },
  meal: { mode: "fast", time: "13:15" },
};

function planWithOfficialShow() {
  const plan = buildUniversalPlan({ ...profile, dayCount: 1 });
  plan.profile.entertainment = { includeShows: true };
  const day = plan.days[0];
  const finalFlex = day.steps.at(-1);
  assert.equal(finalFlex.kind, "flex");
  const performanceStartMin = finalFlex.startMin + 10;
  const show = {
    id: "day-1-show-funny-in-sweet-valley-show-1120",
    kind: "show",
    showId: "funny-in-sweet-valley-show",
    title: "Funny in Sweet Valley Show",
    description: "Zabawny show dla małych i dużych, prowadzony przez charyzmatycznego bohatera.",
    venue: "Town Hall Theatre",
    officialUrl: "https://energylandia.pl/show/funny-in-sweet-valley-show/",
    mapUrl: "https://energylandia.pl/mapa-parku/?location=238",
    imageUrl: "https://energylandia.pl/wp-content/uploads/2026/04/funny_in_sv.jpg",
    zone: "sweet-valley",
    startMin: finalFlex.startMin,
    performanceStartMin,
    endMin: performanceStartMin + 15,
    durationMinutes: 15,
    performanceTimes: ["18:30", "18:40", "19:15"],
    walkingMinutes: 6,
    sourceCheckedAt: "2026-07-14T08:30:00.000Z",
  };
  finalFlex.startMin = show.endMin;
  day.steps.splice(-1, 0, show);
  return plan;
}

test("plan przechodzi bezpieczny round-trip przez link", () => {
  const plan = buildUniversalPlan(profile);
  const decoded = decodePlan(encodePlan(plan));
  assert.ok(decoded);
  assert.equal(decoded.days.length, 2);
  assert.equal(decoded.profile.members.length, 3);
  assert.equal(decoded.profile.visitStartDate, "2026-07-14");
  assert.equal(decoded.safety.valid, true);
  assert.deepEqual(decoded.days.map((day) => day.steps.map((step) => step.id)), plan.days.map((day) => day.steps.map((step) => step.id)));
});

test("round-trip planu 1–3 dni zachowuje cały dzień oraz opcje zapasowe", () => {
  for (const dayCount of [1, 2, 3]) {
    const plan = buildUniversalPlan({ ...profile, dayCount });
    const decoded = decodePlan(encodePlan(plan));
    assert.ok(decoded);
    assert.equal(decoded.days.length, dayCount);
    decoded.days.forEach((day, index) => {
      const sourceFlex = plan.days[index].steps.at(-1);
      const decodedFlex = day.steps.at(-1);
      assert.equal(sourceFlex.kind, "flex");
      assert.equal(decodedFlex.kind, "flex");
      assert.equal(decodedFlex.unplannedUntil ?? decodedFlex.endMin, 20 * 60);
      assert.deepEqual(decodedFlex.backupAttractionIds, sourceFlex.backupAttractionIds);
      assert.equal(day.stats.end, "20:00");
      assert.equal(day.stats.declaredDeparture, "20:00");
    });
  }
});

test("round-trip krótkiej wizyty 10:00–12:00 nie ucina końcówki dnia", () => {
  const plan = buildUniversalPlan({
    ...profile,
    dayCount: 1,
    arrivalTime: "10:00",
    departureTime: "12:00",
    meal: { mode: "fast", time: "11:00" },
  });
  const decoded = decodePlan(encodePlan(plan));

  assert.ok(decoded);
  const finalStep = decoded.days[0].steps.at(-1);
  assert.equal(finalStep.kind, "flex");
  assert.equal(finalStep.unplannedUntil ?? finalStep.endMin, 12 * 60);
  assert.equal(decoded.days[0].stats.end, "12:00");
  assert.equal(decoded.days[0].stats.declaredDeparture, "12:00");

  const truncated = structuredClone(plan);
  truncated.days[0].steps.pop();
  assert.equal(sanitizeSharedPlan(truncated), null);
});

test("stary link bez pól bufora odzyskuje zadeklarowany koniec dnia", () => {
  const legacy = structuredClone(buildUniversalPlan({ ...profile, dayCount: 3 }));
  const vulnerableFlex = legacy.days.map((day) => day.steps.at(-1))
    .find((step) => step.kind === "flex" && step.endMin < 20 * 60);
  assert.ok(vulnerableFlex);
  legacy.days.forEach((day) => {
    const flex = day.steps.at(-1);
    assert.equal(flex.kind, "flex");
    delete flex.unplannedUntil;
    delete flex.backupAttractionIds;
  });

  const restored = sanitizeSharedPlan(legacy);
  assert.ok(restored);
  restored.days.forEach((day) => {
    const restoredFlex = day.steps.at(-1);
    assert.equal(restoredFlex.unplannedUntil ?? restoredFlex.endMin, 20 * 60);
    assert.deepEqual(restoredFlex.backupAttractionIds, []);
    assert.equal(day.stats.end, "20:00");
  });
});

test("uszkodzony lub obcy payload jest odrzucany", () => {
  assert.equal(decodePlan("to-nie-jest-plan"), null);
  assert.equal(sanitizeSharedPlan({ version: 99, profile: {}, days: [] }), null);
  assert.equal(sanitizeSharedPlan({ version: 1, profile, days: [] }), null);
});

test("import bezpiecznie odrzuca null i kolekcje o złym typie", () => {
  const plan = buildUniversalPlan(profile);
  const variants = [
    null,
    { ...plan, days: null },
    { ...plan, days: "Dzień 1" },
    { ...plan, profile: { ...plan.profile, members: null } },
    { ...plan, days: [null] },
    { ...plan, days: [{ steps: null }] },
    { ...plan, days: [{ steps: {} }] },
  ];
  variants.forEach((variant) => {
    assert.doesNotThrow(() => sanitizeSharedPlan(variant));
    assert.equal(sanitizeSharedPlan(variant), null);
  });
});

test("import nie pomija uszkodzonych kroków i odrzuca niesensowne godziny", () => {
  const plan = buildUniversalPlan(profile);
  const malformed = structuredClone(plan);
  malformed.days[0].steps[0] = null;
  assert.equal(sanitizeSharedPlan(malformed), null);

  const outsideVisit = structuredClone(plan);
  outsideVisit.days[0].steps[0].startMin = 9 * 60;
  assert.equal(sanitizeSharedPlan(outsideVisit), null);

  const backwards = structuredClone(plan);
  backwards.days[0].steps[0].endMin = backwards.days[0].steps[0].startMin;
  assert.equal(sanitizeSharedPlan(backwards), null);

  const flexBeforeRide = structuredClone(plan);
  const flexDay = flexBeforeRide.days.find((day) => day.steps.some((step) => step.kind === "flex"));
  const flexIndex = flexDay.steps.findIndex((step) => step.kind === "flex");
  [flexDay.steps[flexIndex], flexDay.steps[flexIndex - 1]] = [flexDay.steps[flexIndex - 1], flexDay.steps[flexIndex]];
  assert.equal(sanitizeSharedPlan(flexBeforeRide), null);
});

test("import nie ucina po cichu nadmiarowych przydziałów podziału", () => {
  const plan = buildUniversalPlan(profile);
  const forged = structuredClone(plan);
  const split = forged.days.flatMap((day) => day.steps).find((step) => step.kind === "split");
  assert.ok(split);
  split.assignments.push(structuredClone(split.assignments[0]));
  assert.equal(sanitizeSharedPlan(forged), null);
});

test("import odrzuca atrakcję powtórzoną w planie", () => {
  const plan = buildUniversalPlan(profile);
  const duplicate = structuredClone(plan);
  const rides = duplicate.days.flatMap((day) => day.steps).filter((step) => step.kind === "ride");
  assert.ok(rides.length >= 2);
  rides[1].attractionId = rides[0].attractionId;
  assert.equal(sanitizeSharedPlan(duplicate), null);
});

test("bezpieczne wartości domyślne naprawiają metadane, ale nie odwrócone godziny wizyty", () => {
  const plan = buildUniversalPlan(profile);
  const fallback = structuredClone(plan);
  fallback.profile.arrivalTime = "jutro";
  fallback.profile.departureTime = null;
  fallback.profile.meal.time = "23:30";
  const sanitized = sanitizeSharedPlan(fallback);
  assert.ok(sanitized);
  assert.equal(sanitized.profile.arrivalTime, "10:00");
  assert.equal(sanitized.profile.departureTime, "20:00");
  assert.equal(sanitized.profile.meal.time, "15:00");

  const reversed = structuredClone(plan);
  reversed.profile.arrivalTime = "20:00";
  reversed.profile.departureTime = "10:00";
  assert.equal(sanitizeSharedPlan(reversed), null);
});

test("adres e-mail nie należy do snapshotu planu", () => {
  const plan = buildUniversalPlan(profile);
  assert.equal(JSON.stringify(plan).includes("@"), false);
});

test("link anonimizuje nazwy i ID, zachowując dane wymagane do kontroli bezpieczeństwa", () => {
  const plan = buildUniversalPlan(profile);
  plan.profile.members[0].name = "Bardzo Tajne Imię";
  plan.profile.members[1].name = "Drugi Prywatny Uczestnik";
  const payload = encodePlan(plan);
  const rawSnapshot = Buffer.from(payload, "base64url").toString("utf8");
  assert.equal(rawSnapshot.includes("Bardzo Tajne Imię"), false);
  assert.equal(rawSnapshot.includes("Drugi Prywatny Uczestnik"), false);

  const decoded = decodePlan(payload);
  assert.ok(decoded);
  assert.deepEqual(decoded.profile.members.map((member) => member.name), ["Dorosły 1", "Dorosły 2", "Dziecko 1"]);
  assert.deepEqual(decoded.profile.members.map((member) => member.id), ["adult-1", "adult-2", "child-1"]);
  assert.deepEqual(decoded.profile.members.map(({ age, height }) => ({ age, height })), profile.members.map(({ age, height }) => ({ age, height })));
  assert.equal(decoded.safety.valid, true);
});

test("dobrowolny pokaz zachowuje bezpieczny termin oraz oficjalne odnośniki w krótkim linku", () => {
  const plan = planWithOfficialShow();
  const decoded = decodePlan(encodePlan(plan));

  assert.ok(decoded);
  assert.equal(decoded.profile.entertainment.includeShows, true);
  const show = decoded.days[0].steps.find((step) => step.kind === "show");
  assert.deepEqual({
    id: show.id,
    kind: show.kind,
    showId: show.showId,
    title: show.title,
    venue: show.venue,
    officialUrl: show.officialUrl,
    mapUrl: show.mapUrl,
    startMin: show.startMin,
    performanceStartMin: show.performanceStartMin,
    endMin: show.endMin,
    durationMinutes: show.durationMinutes,
    performanceTimes: show.performanceTimes,
    walkingMinutes: show.walkingMinutes,
    sourceCheckedAt: show.sourceCheckedAt,
  }, {
    id: "day-1-show-funny-in-sweet-valley-show-1120",
    kind: "show",
    showId: "funny-in-sweet-valley-show",
    title: "Funny in Sweet Valley Show",
    venue: "Town Hall Theatre",
    officialUrl: "https://energylandia.pl/show/funny-in-sweet-valley-show/",
    mapUrl: "https://energylandia.pl/mapa-parku/?location=238",
    startMin: 1110,
    performanceStartMin: 1120,
    endMin: 1135,
    durationMinutes: 15,
    performanceTimes: ["18:30", "18:40", "19:15"],
    walkingMinutes: 6,
    sourceCheckedAt: "2026-07-14T08:30:00.000Z",
  });
  assert.match(show.description, /oficjalny opis/i);
  assert.equal(show.imageUrl, null);
  assert.equal(decoded.days[0].steps.length, 15);
  assert.equal(decoded.safety.valid, true);
});

test("v2 skraca plan z pokazem do formatu komunikatorów i nadal czyta dawny payload", () => {
  const plan = planWithOfficialShow();
  const compactPayload = encodePlan(plan);
  const legacyPayload = Buffer.from(JSON.stringify(plan)).toString("base64url");

  assert.ok(compactPayload.length < 1_200);
  assert.ok(compactPayload.length < legacyPayload.length * 0.35);
  assert.ok(decodePlan(legacyPayload));
  assert.equal(decodePlan("eyJ2IjoyLCJwIjpbXX0"), null);

  const forgedSnapshot = JSON.parse(Buffer.from(compactPayload, "base64url").toString("utf8"));
  const firstRide = forgedSnapshot.d[0].find((step) => step[0] === "r");
  firstRide[1] = "zadra"; // 140 cm: nie może przejść przez profil z dzieckiem 122 cm.
  const forgedPayload = Buffer.from(JSON.stringify(forgedSnapshot)).toString("base64url");
  assert.equal(decodePlan(forgedPayload), null);
});

test("pokaz jest odrzucany bez świadomego włączenia oraz dla obcych danych", () => {
  const disabled = planWithOfficialShow();
  disabled.profile.entertainment.includeShows = false;
  assert.equal(sanitizeSharedPlan(disabled), null);

  const foreignUrl = planWithOfficialShow();
  foreignUrl.days[0].steps.find((step) => step.kind === "show").officialUrl = "https://example.com/show/funny";
  assert.equal(sanitizeSharedPlan(foreignUrl), null);

  const missingRelevantTime = planWithOfficialShow();
  missingRelevantTime.days[0].steps.find((step) => step.kind === "show").performanceTimes = ["18:30"];
  assert.equal(sanitizeSharedPlan(missingRelevantTime), null);

  const brokenDuration = planWithOfficialShow();
  brokenDuration.days[0].steps.find((step) => step.kind === "show").durationMinutes = 20;
  assert.equal(sanitizeSharedPlan(brokenDuration), null);
});

test("import odrzuca duplikaty uczestników i ponownie liczy statystyki", () => {
  const plan = buildUniversalPlan(profile);
  const duplicate = structuredClone(plan);
  duplicate.profile.members[1].id = duplicate.profile.members[0].id;
  assert.equal(sanitizeSharedPlan(duplicate), null);

  const forgedStats = structuredClone(plan);
  forgedStats.days[0].stats = { start: {}, end: [], walkingMinutes: "nieskończoność" };
  const sanitized = sanitizeSharedPlan(forgedStats);
  assert.ok(sanitized);
  assert.equal(typeof sanitized.days[0].stats.start, "string");
  assert.equal(typeof sanitized.days[0].stats.walkingMinutes, "number");
});

test("szkic e-maila zawiera rozpiskę bez wielotysięcznego hasha planu", () => {
  const plan = buildUniversalPlan(profile);
  const longPlanUrl = `https://example.com/planer/#plan=${encodePlan(plan)}`;
  const draft = createEmailDraftUrl("rodzina@example.com", longPlanUrl, plan);
  assert.ok(draft.startsWith("mailto:rodzina%40example.com"));
  assert.ok(decodeURIComponent(draft).includes("Dzień 1"));
  assert.equal(decodeURIComponent(draft).includes("#plan="), false);
  assert.ok(draft.length < 7000);
});

test("szkic e-maila jasno opisuje wstawiony pokaz", () => {
  const plan = planWithOfficialShow();
  const draft = decodeURIComponent(createEmailDraftUrl("rodzina@example.com", "https://example.com/planer/#plan=sekret", plan));
  assert.match(draft, /18:40 — POKAZ: Funny in Sweet Valley Show \(15 min, Town Hall Theatre\)/);
});

test("krótki link zapisuje wyłącznie compact v2 i ma klikalny hash bez znaku równości", async () => {
  const plan = buildUniversalPlan(profile);
  const token = "AbCdEfGhIjKlMn_o";
  let request = null;
  const url = await createShortPlanLink(plan, {
    apiBase: "https://links.example",
    href: "https://example.com/zabhop/planer-energylandia/#plan=legacy",
    fetchImpl: async (input, init) => {
      request = { input, init };
      return { ok: true, status: 201, json: async () => ({ token }) };
    },
  });

  assert.equal(url, `https://example.com/zabhop/planer-energylandia/#p/${token}`);
  assert.equal(url.includes("="), false);
  assert.equal(request.input, "https://links.example/plans");
  assert.equal(request.init.method, "POST");
  const body = JSON.parse(request.init.body);
  assert.deepEqual(Object.keys(body), ["payload"]);
  assert.equal(body.payload, encodeCompactPlan(plan));
  assert.equal(JSON.parse(Buffer.from(body.payload, "base64url").toString("utf8")).v, 2);
  assert.equal(shortPlanTokenFromHash(new URL(url).hash), token);
  assert.equal(hasShortPlanHash(new URL(url).hash), true);
});

test("krótki link pobiera plan z API i nadal przechodzi pełną walidację bezpieczeństwa", async () => {
  const source = buildUniversalPlan(profile);
  const payload = encodeCompactPlan(source);
  const token = "pLanTok3n_123456";
  const loaded = await loadShortPlan(token, {
    apiBase: "https://links.example/",
    fetchImpl: async (input, init) => {
      assert.equal(input, `https://links.example/plans/${token}`);
      assert.equal(init.method, undefined);
      return { ok: true, status: 200, json: async () => ({ payload }) };
    },
  });

  assert.ok(loaded);
  assert.equal(loaded.safety.valid, true);
  assert.deepEqual(loaded.days.map((day) => day.steps.map((step) => step.id)), source.days.map((day) => day.steps.map((step) => step.id)));
});

test("krótki link nie zamienia błędu API w długi link ani nie przyjmuje niepełnego tokenu", async () => {
  const plan = buildUniversalPlan(profile);
  await assert.rejects(
    () => createShortPlanLink(plan, {
      apiBase: "https://links.example",
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    }),
    (error) => error?.code === "request-failed",
  );
  await assert.rejects(
    () => loadShortPlan("za-krotki", { apiBase: "https://links.example", fetchImpl: async () => { throw new Error("nie powinno wywołać fetch"); } }),
    (error) => error?.code === "invalid-token",
  );
  assert.equal(shortPlanTokenFromHash("#p/za-krotki"), null);
  assert.equal(hasShortPlanHash("#p/za-krotki"), true);
});
