const assert = require("node:assert/strict");
const test = require("node:test");
const storesCatalog = require("../stores.json");
const otherStoresCatalog = require("../other-stores.json");
const {
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
  assert.equal(statusAt(null).state, "unknown");
  const partial = normalizeOfficialHours({ "mon-sat": "06:00:00 - 23:00:00" });
  assert.equal(statusAt(partial, { date: new Date("2026-07-12T10:00:00Z") }).state, "unknown");
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

test("bundled Zator stores never turn the official Sunday sentinel into confirmed open", () => {
  const screenshotMoment = new Date("2026-07-11T22:25:00Z"); // Sunday 00:25 in Zator.
  for (const id of ["ZB158", "ZE315"]) {
    const row = storesCatalog.find((store) => store[0] === id);
    assert.ok(row, `missing fixture ${id}`);
    assert.equal(row[5][6], null);
    assert.equal(statusAt(row[5], { date: screenshotMoment }).state, "unknown");
  }
});

test("bundled catalog rejects stale or undated OSM all-day claims from the screenshot", () => {
  const suspectIds = [
    "osm-n-2696878132", // stale SPAR, now reported under another brand
    "osm-w-889502145", // Auchan Easy without a check date
    "osm-n-12805812035",
    "osm-n-3368741951",
    "osm-n-2000515371"
  ];
  for (const id of suspectIds) {
    const store = otherStoresCatalog.find((candidate) => candidate.id === id);
    assert.ok(store, `missing fixture ${id}`);
    assert.equal(Object.hasOwn(store, "hours"), false, `${id} must remain unconfirmed`);
  }
  const recentlyChecked = otherStoresCatalog.find((store) => store.id === "osm-n-5254419323");
  assert.deepEqual(recentlyChecked.hours, Array(7).fill("0-1440"));
});
