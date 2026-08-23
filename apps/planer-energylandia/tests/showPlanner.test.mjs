import test from "node:test";
import assert from "node:assert/strict";
import { buildUniversalPlan, formatPlanTime, validatePlanSafety } from "../src/planner.js";
import { overlayShowsOnPlan } from "../src/showPlanner.js";

function profile(overrides = {}) {
  return {
    dayCount: 1,
    visitStartDate: "2026-07-14",
    arrivalTime: "10:00",
    departureTime: "20:00",
    pace: "normal",
    splitPolicy: "never",
    members: [
      { id: "a1", role: "adult", name: "A", age: 35, height: 175 },
      { id: "a2", role: "adult", name: "B", age: 34, height: 170 },
      { id: "c1", role: "child", name: "C", age: 7, height: 122 },
    ],
    preferences: { intensity: "mixed", interests: ["coasters", "family"], wet: "ok", maxQueue: 45 },
    meal: { mode: "fast", time: "13:15" },
    entertainment: { includeShows: true },
    ...overrides,
  };
}

function scheduleFor(plan, { checkedAt = "2026-07-14T10:00:00.000Z" } = {}) {
  const flex = plan.days[0].steps.at(-1);
  const performanceStartMin = flex.startMin + 10;
  return {
    source: { checkedAt, status: "fresh", url: "https://energylandia.pl/show/" },
    shows: [{
      id: "funny-in-sweet-valley-show",
      title: "Funny in Sweet Valley Show",
      description: "Zabawny show dla małych i dużych, prowadzony przez charyzmatycznego bohatera.",
      durationMinutes: 15,
      venue: "Town Hall Theatre",
      url: "https://energylandia.pl/show/funny-in-sweet-valley-show/",
      mapUrl: "https://energylandia.pl/mapa-parku/?location=238",
      imageUrl: "https://energylandia.pl/wp-content/uploads/2026/04/funny_in_sv.jpg",
      checkedAt,
      completeForScheduling: true,
      stale: false,
      schedule: [{ date: "2026-07-14", times: [formatPlanTime(performanceStartMin)] }],
    }],
  };
}

test("świeży pokaz wchodzi wyłącznie w końcowy bufor, bez usuwania atrakcji ani obiadu", () => {
  const base = buildUniversalPlan(profile());
  const baseRideIds = base.days[0].steps.filter((step) => step.kind === "ride").map((step) => step.attractionId);
  const withShow = overlayShowsOnPlan(base, scheduleFor(base), { now: Date.parse("2026-07-14T10:30:00.000Z") });
  const day = withShow.days[0];
  const show = day.steps.find((step) => step.kind === "show");
  const finalFlex = day.steps.at(-1);

  assert.ok(show);
  assert.equal(show.performanceTimes.length, 1);
  assert.equal(show.description.includes("charyzmatycznego"), true);
  assert.deepEqual(day.steps.filter((step) => step.kind === "ride").map((step) => step.attractionId), baseRideIds);
  assert.equal(day.steps.filter((step) => step.kind === "meal").length, 1);
  assert.equal(finalFlex.kind, "flex");
  assert.ok(finalFlex.endMin - finalFlex.startMin >= 60);
  assert.equal(finalFlex.unplannedUntil ?? finalFlex.endMin, 20 * 60);
  assert.equal(validatePlanSafety(withShow).valid, true);
});

test("nieświeży terminarz nie udaje bezpiecznego wpisu do planu", () => {
  const base = buildUniversalPlan(profile());
  const stale = overlayShowsOnPlan(base, scheduleFor(base), { now: Date.parse("2026-07-14T15:01:00.000Z") });
  assert.equal(stale.days[0].steps.some((step) => step.kind === "show"), false);
  assert.equal(stale.safety.valid, true);
});

test("warstwa pokazów nic nie zmienia bez świadomego wyboru", () => {
  const base = buildUniversalPlan(profile({ entertainment: { includeShows: false } }));
  const unchanged = overlayShowsOnPlan(base, scheduleFor(base), { now: Date.parse("2026-07-14T10:30:00.000Z") });
  assert.equal(unchanged, base);
});

test("oficjalne godziny z kalendarza mogą wejść do bufora tylko z aktualnym, kompletnym opisem", () => {
  const now = Date.parse("2026-07-14T10:30:00.000Z");
  const base = buildUniversalPlan(profile());
  const details = scheduleFor(base, { checkedAt: "2026-07-14T10:00:00.000Z" });
  const performance = details.shows[0].schedule[0].times[0];
  const parkCalendar = {
    source: {
      url: "https://energylandia.pl/kalendarz/",
      checkedAt: "2026-07-14T10:15:00.000Z",
      status: "fresh",
    },
    days: {
      "2026-07-14": {
        date: "2026-07-14",
        status: "open",
        opensAt: "10:00",
        closesAt: "20:00",
        shows: [{ title: details.shows[0].title, url: details.shows[0].url, times: [performance] }],
      },
    },
  };
  details.shows[0].schedule = [];
  const merged = overlayShowsOnPlan(base, details, { now, parkCalendar });
  const plannedShow = merged.days[0].steps.find((step) => step.kind === "show");

  assert.ok(plannedShow);
  assert.equal(plannedShow.performanceStartMin, Number(performance.slice(0, 2)) * 60 + Number(performance.slice(3)));
  assert.equal(plannedShow.sourceCheckedAt, "2026-07-14T10:15:00.000Z");
  assert.equal(merged.safety.valid, true);

  const staleDetails = structuredClone(details);
  staleDetails.source.checkedAt = "2026-07-13T03:00:00.000Z";
  staleDetails.shows[0].checkedAt = "2026-07-13T03:00:00.000Z";
  const blocked = overlayShowsOnPlan(base, staleDetails, { now, parkCalendar });
  assert.equal(blocked.days[0].steps.some((step) => step.kind === "show"), false);
  assert.equal(blocked.safety.valid, true);
});
