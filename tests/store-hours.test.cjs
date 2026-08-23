const assert = require("node:assert/strict");
const test = require("node:test");
const storesCatalog = require("../stores.json");
const otherStoresCatalog = require("../other-stores.json");
const {
  availabilityStatusAt,
  estimateWalkingMinutes,
  isPolishPublicHoliday,
  normalizeOfficialHours,
  parseOsmOpeningHours,
  rankStores,
  statusAt
} = require("../store-hours.js");

test("normalizes official Żabka weekday and Sunday hours", () => {
  const hours = normalizeOfficialHours({
    "mon-sat": "06:00:00 - 23:00:00",
    sun: "09:00:00 - 22:00:00"
  });
  assert.deepEqual(hours, ["360-1380", "360-1380", "360-1380", "360-1380", "360-1380", "360-1380", "540-1320"]);
});

test("keeps the unreliable official midnight sentinel unknown and false closed", () => {
  const ambiguous = normalizeOfficialHours({ "mon-sun": "00:00:00 - 00:00:00" });
  assert.equal(ambiguous, null);
  const sundayAmbiguous = normalizeOfficialHours({
    "mon-sat": "06:00:00 - 23:00:00",
    sun: "00:00:00 - 00:00:00"
  });
  assert.equal(sundayAmbiguous[6], null);
  const sundayClosed = normalizeOfficialHours({ "mon-sat": "06:00:00 - 23:00:00", sun: false });
  assert.equal(sundayClosed[6], "");
});

test("keeps explicit OSM 24/7 distinct but labels it only as open now", () => {
  const parsed = parseOsmOpeningHours("24/7");
  assert.deepEqual(parsed.hours, Array(7).fill("0-1440"));
  assert.equal(statusAt(parsed.hours, { date: new Date("2026-07-12T00:30:00Z") }).label, "Otwarte teraz");
});

test("keeps overnight spill together with the next day's own official hours", () => {
  const hours = normalizeOfficialHours({ "mon-sat": "06:00:00 - 02:00:00", sun: "09:00:00 - 22:00:00" });
  assert.equal(hours[0], "360-1440");
  assert.equal(hours[5], "0-120,360-1440");
  assert.equal(hours[6], "540-1320");
});

test("parses common OSM schedules and public-holiday closures", () => {
  const parsed = parseOsmOpeningHours("Mo-Fr 06:00-23:00; Sa 07:00-22:00; Su,PH off");
  assert.deepEqual(parsed.hours, ["360-1380", "360-1380", "360-1380", "360-1380", "360-1380", "420-1320", ""]);
  assert.equal(parsed.holidaysClosed, true);
});

test("splits an overnight OSM range over two days", () => {
  const parsed = parseOsmOpeningHours("Fr 22:00-02:00");
  assert.equal(parsed.hours[4], "1320-1440");
  assert.equal(parsed.hours[5], "0-120");
});

test("later OSM rules override earlier hours and previous-night spill", () => {
  const saturdayOverride = parseOsmOpeningHours("Mo-Sa 07:00-21:00; Sa 09:00-20:00");
  assert.equal(saturdayOverride.hours[5], "540-1200");

  const overnightOverride = parseOsmOpeningHours("Mo-Fr 05:00-01:00; Sa 05:00-23:30");
  assert.equal(overnightOverride.hours[4], "0-60,300-1440");
  assert.equal(overnightOverride.hours[5], "300-1410");
});

test("overnight spill appends to a previously defined following day", () => {
  const parsed = parseOsmOpeningHours("Mo 06:00-23:30; Tu-Sa 05:00-01:00; Su 06:00-01:00");
  assert.equal(parsed.hours[0], "0-60,360-1410");
  assert.equal(parsed.hours[6], "360-1440");
});

test("leaves complex date-specific OSM expressions unknown", () => {
  assert.equal(parseOsmOpeningHours("Mo-Sa 08:00-22:00; Jan 25 Su 09:00-20:00; PH off"), null);
  assert.equal(parseOsmOpeningHours("Mo-Su 00:00-00:00"), null);
  assert.equal(parseOsmOpeningHours("Mo-Sa 08:00-22:00; PH 10:00-16:00"), null);
});

test("recognizes an explicit all-week closure", () => {
  assert.deepEqual(parseOsmOpeningHours("closed").hours, Array(7).fill(""));
});

test("evaluates current status in the Warsaw time zone", () => {
  const hours = normalizeOfficialHours({ "mon-sat": "06:00:00 - 23:00:00", sun: "09:00:00 - 22:00:00" });
  assert.equal(statusAt(hours, { date: new Date("2026-07-11T20:30:00Z") }).state, "open");
  assert.equal(statusAt(hours, { date: new Date("2026-07-11T21:30:00Z") }).state, "closed");
  assert.equal(statusAt(hours, { date: new Date("2026-07-11T21:00:00Z") }).state, "closed");
});

test("does not pretend unknown hours are open", () => {
  assert.deepEqual(statusAt(null), {
    state: "unknown",
    label: "Godziny niepotwierdzone",
    badge: "NIEPOTWIERDZONE"
  });
  const partial = normalizeOfficialHours({ "mon-sat": "06:00:00 - 23:00:00" });
  assert.deepEqual(statusAt(partial, { date: new Date("2026-07-12T10:00:00Z") }), {
    state: "unknown",
    label: "Godziny niepotwierdzone",
    badge: "NIEPOTWIERDZONE"
  });
});

test("marks unknown Żabka hours as likely open only in the conservative daytime window", () => {
  const beforeMorning = new Date("2026-07-12T04:59:00Z"); // 06:59 in Warsaw
  const morning = new Date("2026-07-12T05:00:00Z"); // 07:00 in Warsaw
  const zatorScreenshot = new Date("2026-07-12T07:28:00Z"); // 09:28 in Warsaw
  const evening = new Date("2026-07-12T19:00:00Z"); // 21:00 in Warsaw

  assert.equal(availabilityStatusAt(null, { date: beforeMorning, allowLikelyUnknown: true }).state, "unknown");
  assert.equal(availabilityStatusAt(null, { date: morning, allowLikelyUnknown: true }).state, "likely");
  assert.deepEqual(
    availabilityStatusAt(null, { date: zatorScreenshot, allowLikelyUnknown: true }),
    {
      state: "likely",
      label: "Prawdopodobnie otwarte · brak godzin",
      badge: "PRAWDOPODOBNIE OTWARTE"
    }
  );
  assert.equal(availabilityStatusAt(null, { date: evening, allowLikelyUnknown: true }).state, "unknown");
  assert.equal(availabilityStatusAt(null, { date: zatorScreenshot }).state, "unknown");
});

test("never upgrades explicitly closed hours to probably open", () => {
  const closed = Array(7).fill("");
  const zatorScreenshot = new Date("2026-07-12T07:28:00Z");
  assert.equal(
    availabilityStatusAt(closed, { date: zatorScreenshot, allowLikelyUnknown: true }).state,
    "closed"
  );
});

test("never assumes an unknown Żabka is open on a Polish public holiday", () => {
  const christmasMorning = new Date("2026-12-25T08:00:00Z"); // 09:00 in Warsaw
  assert.equal(
    availabilityStatusAt(null, { date: christmasMorning, allowLikelyUnknown: true }).state,
    "unknown"
  );
});

test("recognizes fixed and movable Polish public holidays", () => {
  assert.equal(isPolishPublicHoliday(2026, 12, 24), true);
  assert.equal(isPolishPublicHoliday(2026, 4, 6), true);
  assert.equal(isPolishPublicHoliday(2026, 7, 11), false);
});

test("open-now ranking filters before limiting and never treats unknown as open", () => {
  const closed = Array(7).fill("");
  const open = Array(7).fill("0-1440");
  const stores = [
    ...Array.from({ length: 5 }, (_, index) => ({ id: `closed-${index}`, distance: 50 + index, hours: closed })),
    { id: "unknown", distance: 80 },
    { id: "open", distance: 300, hours: open }
  ];
  assert.deepEqual(rankStores(stores, { availability: "open" }).map((store) => store.id), ["open"]);
  assert.deepEqual(rankStores(stores, { availability: "all" }).map((store) => store.id), ["closed-0", "closed-1", "closed-2", "closed-3", "closed-4"]);
});

test("open-now Żabka ranking prefers a closer probably-open store when a confirmed shop is much farther", () => {
  const unknownNear = { id: "near-unknown", hours: null };
  const confirmedFar = { id: "far-confirmed", hours: Array(7).fill("420-1260") };
  const stores = [
    { ...unknownNear, distance: 590 },
    { ...confirmedFar, distance: 1200 }
  ];
  const date = new Date("2026-07-12T07:28:00Z");

  assert.deepEqual(
    rankStores(stores, { availability: "open", allowLikelyUnknown: true, date }).map((store) => store.id),
    ["near-unknown", "far-confirmed"]
  );
  assert.equal(
    rankStores(stores, { availability: "open", allowLikelyUnknown: true, date })[0].openingStatus.state,
    "likely"
  );
});

test("open-now ranking prefers a similarly close confirmed store over an uncertain Żabka", () => {
  const open = Array(7).fill("420-1260");
  const date = new Date("2026-07-12T07:28:00Z");
  const stores = [
    { id: "unknown-670m", distance: 670, hours: null },
    { id: "confirmed-900m", distance: 900, hours: open }
  ];

  assert.deepEqual(
    rankStores(stores, { availability: "open", allowLikelyUnknown: true, date }).map((store) => store.id),
    ["confirmed-900m", "unknown-670m"]
  );
});

test("an ambiguous official Sunday sentinel stays unknown around midnight", () => {
  const screenshotMoment = new Date("2026-07-11T22:25:00Z"); // Sunday 00:25 in Zator.
  const hours = normalizeOfficialHours({
    "mon-sat": "06:00:00 - 23:00:00",
    sun: "00:00:00 - 00:00:00"
  });
  assert.equal(hours[6], null);
  assert.equal(statusAt(hours, { date: screenshotMoment }).state, "unknown");
});

test("bundled catalogs stay structurally valid as store IDs change over time", () => {
  assert.ok(storesCatalog.length >= 10000);
  assert.ok(otherStoresCatalog.length >= 10000);
  for (const row of storesCatalog.slice(0, 40)) {
    assert.equal(typeof row[0], "string");
    assert.ok(Number.isFinite(row[1]) && Number.isFinite(row[2]));
    assert.ok(row[5] == null || (Array.isArray(row[5]) && row[5].length === 7));
  }
  for (const store of otherStoresCatalog.slice(0, 40)) {
    assert.equal(typeof store.id, "string");
    assert.ok(Number.isFinite(store.lat) && Number.isFinite(store.lon));
    assert.ok(store.hours == null || (Array.isArray(store.hours) && store.hours.length === 7));
  }
});

test("other-store ranking keeps unconfirmed shops visible without claiming they are open", () => {
  const date = new Date("2026-08-23T10:00:00Z");
  const stores = [
    { id: "unconfirmed-next-door", distance: 45, hours: null },
    { id: "confirmed-close", distance: 230, hours: Array(7).fill("0-1440") },
    { id: "closed", distance: 30, hours: Array(7).fill("") }
  ];
  const ranked = rankStores(stores, { availability: "open", includeUnknown: true, date });
  assert.deepEqual(ranked.map((store) => store.id), ["confirmed-close", "unconfirmed-next-door"]);
  assert.equal(ranked[1].openingStatus.label, "Godziny niepotwierdzone");
  assert.equal(ranked[1].openingStatus.state, "unknown");
});

test("shows precise closing-soon and opening-soon information", () => {
  const hours = Array(7).fill("480-1200");
  const closing = statusAt(hours, { date: new Date("2026-08-24T17:48:00Z") }); // 19:48 Warsaw.
  assert.equal(closing.label, "Zamyka się za 12 min · 20:00");
  assert.equal(closing.minutesUntilChange, 12);
  assert.equal(closing.state, "open");

  const opening = statusAt(hours, { date: new Date("2026-08-24T05:46:00Z") }); // 07:46 Warsaw.
  assert.equal(opening.label, "Otwiera się za 14 min · 08:00");
  assert.equal(opening.state, "closed");
});

test("does not announce midnight closure for a continuously overnight shop", () => {
  const hours = parseOsmOpeningHours("Mo-Su 18:00-02:00").hours;
  const status = statusAt(hours, { date: new Date("2026-08-24T21:49:00Z") }); // 23:49 Warsaw.
  assert.equal(status.state, "open");
  assert.equal(status.urgency, undefined);
});

test("estimates walking time locally and avoids a shop that closes before arrival", () => {
  assert.equal(estimateWalkingMinutes(20), 0);
  assert.equal(estimateWalkingMinutes(100), 2);
  assert.ok(estimateWalkingMinutes(1000) >= 14);
  assert.equal(estimateWalkingMinutes(Number.NaN), null);

  const date = new Date("2026-08-24T17:48:00Z"); // 19:48 Warsaw.
  const stores = [
    { id: "closing-before-arrival", distance: 1100, hours: Array(7).fill("480-1200") },
    { id: "stays-open", distance: 1350, hours: Array(7).fill("480-1380") }
  ];
  assert.deepEqual(
    rankStores(stores, { availability: "open", date }).map((store) => store.id),
    ["stays-open", "closing-before-arrival"]
  );
});
