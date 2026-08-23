import test from "node:test";
import assert from "node:assert/strict";
import { ALL_ATTRACTIONS_BY_ID } from "../src/extendedData.js";
import {
  normalizeQueueSnapshot,
  queueForAttraction,
  queueLabel,
  queueRidesFromPayload,
} from "../src/queues.js";

const now = Date.parse("2026-08-23T10:30:00.000Z");
const checkedRide = (ride) => ({ last_updated: "2026-08-23T10:10:00.000Z", ...ride });

test("planer czyta atrakcje z lands mimo pustej listy root i deduplikuje powtórki", () => {
  const payload = {
    snapshot_generated_at: "2026-08-23T10:00:00.000Z",
    rides: [],
    lands: [{ rides: [
      { id: 184, name: "Abyssus (184)", is_open: true, wait_time: 20 },
      { id: 184, name: "Abyssus (184)", is_open: true, wait_time: 20 },
      { id: 154, name: "Zadra (154)", is_open: false, wait_time: 0 },
    ].map(checkedRide) }],
  };

  assert.equal(queueRidesFromPayload(payload).length, 2);
  const snapshot = normalizeQueueSnapshot(payload, { now });
  assert.equal(queueForAttraction(ALL_ATTRACTIONS_BY_ID.abyssus, snapshot).waitTime, 20);
  assert.equal(queueForAttraction(ALL_ATTRACTIONS_BY_ID.zadra, snapshot).isOpen, false);
  assert.equal(snapshot.snapshotGeneratedAt, "2026-08-23T10:00:00.000Z");
});

test("duplikat z lands zastępuje starszy odczyt root tylko gdy jest faktycznie nowszy", () => {
  const snapshot = normalizeQueueSnapshot({
    snapshot_generated_at: "2026-08-23T10:20:00.000Z",
    rides: [{ id: 184, name: "Abyssus (184)", is_open: false, wait_time: 0, last_updated: "2026-08-23T07:00:00.000Z" }],
    lands: [{ rides: [checkedRide({ id: 184, name: "Abyssus (184)", is_open: true, wait_time: 18 })] }],
  }, { now });
  const ride = queueForAttraction(ALL_ATTRACTIONS_BY_ID.abyssus, snapshot);

  assert.equal(snapshot.byName.size, 1);
  assert.equal(ride.isOpen, true);
  assert.equal(ride.waitTime, 18);
});

test("numery Queue-Times nie blokują dopasowania flagowych atrakcji", () => {
  const snapshot = normalizeQueueSnapshot({
    snapshot_generated_at: "2026-08-23T10:15:00.000Z",
    rides: [
      { name: "Abyssus (184)", is_open: true, wait_time: 15 },
      { name: "Formula (73)", is_open: true, wait_time: 10 },
      { name: "Zadra (154)", is_open: true, wait_time: 35 },
    ].map(checkedRide),
  }, { now });

  assert.equal(queueForAttraction(ALL_ATTRACTIONS_BY_ID.abyssus, snapshot).waitTime, 15);
  assert.equal(queueForAttraction(ALL_ATTRACTIONS_BY_ID.formula, snapshot).waitTime, 10);
  assert.equal(queueForAttraction(ALL_ATTRACTIONS_BY_ID.zadra, snapshot).waitTime, 35);
});

test("RMF Dragon używa unikalnego oficjalnego numeru bez pomylenia z Dragon Adventure", () => {
  const snapshot = normalizeQueueSnapshot({
    snapshot_generated_at: "2026-08-23T10:15:00.000Z",
    rides: [
      { name: "Dragon Adventure (153)", is_open: true, wait_time: 55 },
      { name: "Dragon (34)", is_open: true, wait_time: 12 },
    ].map(checkedRide),
  }, { now });
  const match = queueForAttraction(ALL_ATTRACTIONS_BY_ID["rmf-dragon"], snapshot);

  assert.equal(match.name, "Dragon (34)");
  assert.equal(match.waitTime, 12);

  const adventureOnly = normalizeQueueSnapshot({
    snapshot_generated_at: "2026-08-23T10:15:00.000Z",
    rides: [checkedRide({ name: "Dragon Adventure (153)", is_open: true, wait_time: 55 })],
  }, { now });
  assert.equal(queueForAttraction(ALL_ATTRACTIONS_BY_ID["rmf-dragon"], adventureOnly), null);
});

test("brak statusu albo kolejki pozostaje nieznany zamiast oznaczać zamknięcie lub zero", () => {
  const snapshot = normalizeQueueSnapshot({
    snapshot_generated_at: "2026-08-23T10:15:00.000Z",
    rides: [
      { name: "Abyssus (184)", wait_time: null },
      { name: "Formula (73)", is_open: true },
    ].map(checkedRide),
  }, { now });
  const abyssus = queueForAttraction(ALL_ATTRACTIONS_BY_ID.abyssus, snapshot);
  const formula = queueForAttraction(ALL_ATTRACTIONS_BY_ID.formula, snapshot);

  assert.equal(abyssus.isOpen, null);
  assert.equal(abyssus.waitTime, null);
  assert.equal(queueLabel(abyssus), "status nieznany");
  assert.equal(formula.isOpen, true);
  assert.equal(formula.waitTime, null);
  assert.equal(queueLabel(formula), "brak czasu");
});

test("stare lub nieudatowane odczyty nie podszywają się pod aktualne kolejki", () => {
  const stale = normalizeQueueSnapshot({
    snapshot_generated_at: "2026-08-22T10:00:00.000Z",
    rides: [{ name: "Zadra (154)", is_open: false, wait_time: 90 }],
  }, { now });
  assert.equal(stale.freshness, "stale");
  assert.equal(stale.updatedAt, Date.parse("2026-08-22T10:00:00.000Z"));
  assert.equal(queueForAttraction(ALL_ATTRACTIONS_BY_ID.zadra, stale).isOpen, null);

  const undated = normalizeQueueSnapshot({ rides: [{ name: "Zadra (154)", is_open: true, wait_time: 0 }] }, { now });
  assert.equal(undated.updatedAt, null);
  assert.equal(undated.freshness, "unknown");
  assert.equal(queueForAttraction(ALL_ATTRACTIONS_BY_ID.zadra, undated).waitTime, null);
});

test("stary albo brakujący last_updated nie staje się świeży przez nowe pobranie całego snapshotu", () => {
  const snapshot = normalizeQueueSnapshot({
    snapshot_generated_at: "2026-08-23T10:25:00.000Z",
    rides: [
      { name: "Zadra (154)", is_open: false, wait_time: 0, last_updated: "2026-08-23T07:30:00.000Z" },
      { name: "Abyssus (184)", is_open: true, wait_time: 55 },
      checkedRide({ name: "Formula (73)", is_open: true, wait_time: 8 }),
    ],
  }, { now });
  const zadra = queueForAttraction(ALL_ATTRACTIONS_BY_ID.zadra, snapshot);
  const abyssus = queueForAttraction(ALL_ATTRACTIONS_BY_ID.abyssus, snapshot);
  const formula = queueForAttraction(ALL_ATTRACTIONS_BY_ID.formula, snapshot);

  assert.equal(snapshot.freshness, "fresh");
  assert.equal(zadra.freshness, "stale");
  assert.equal(zadra.isOpen, null);
  assert.equal(abyssus.freshness, "unknown");
  assert.equal(abyssus.waitTime, null);
  assert.equal(formula.freshness, "fresh");
  assert.equal(formula.waitTime, 8);
});

test("walidacja odrzuca pustą migawkę zamiast zastępować nią dobry snapshot", () => {
  assert.equal(queueRidesFromPayload({ rides: [], lands: [{ rides: [] }] }).length, 0);
  assert.throws(() => normalizeQueueSnapshot({ rides: [], lands: [] }, { now }), /żadnej rozpoznawalnej atrakcji/);
});
