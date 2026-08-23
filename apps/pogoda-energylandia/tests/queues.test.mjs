import test from "node:test";
import assert from "node:assert/strict";
import { ATTRACTIONS } from "../src/parkData.js";
import {
  cautiousWait,
  normalizeQueueSnapshot,
  queueForAttraction,
  queueLabel,
  queueRidesFromPayload,
} from "../src/queues.js";

const now = Date.parse("2026-08-23T10:30:00.000Z");
const checkedRide = (ride) => ({ last_updated: "2026-08-23T10:10:00.000Z", ...ride });

test("dopasowuje polskie znaki i alias pisowni Honey Harbor", () => {
  const queues = {
    byName: new Map([
      ["toffifee kopalnia zlota", { waitTime: 30, isOpen: true }],
      ["honey harbor", { waitTime: 0, isOpen: true }],
    ]),
  };
  const goldMine = ATTRACTIONS.find((item) => item.id === "gold-mine");
  const honey = ATTRACTIONS.find((item) => item.id === "honey-harbour");
  assert.equal(queueForAttraction(goldMine, queues).waitTime, 30);
  assert.equal(queueForAttraction(honey, queues).waitTime, 0);
});

test("ostrożny czas uwzględnia zaniżenia raportowane przez gości", () => {
  assert.equal(cautiousWait(0), 0);
  assert.equal(cautiousWait(20), 30);
  assert.equal(cautiousWait(21), 35);
});

test("łączy rides i lands nawet gdy główne rides jest puste oraz usuwa duplikaty", () => {
  const payload = {
    snapshot_generated_at: "2026-08-23T10:15:00.000Z",
    rides: [{ id: 184, name: "Abyssus (184)" }],
    lands: [{ rides: [
      { id: 184, name: "Abyssus (184)", is_open: true, wait_time: 20 },
      { id: 73, name: "Formula (73)", is_open: true, wait_time: 5 },
    ].map(checkedRide) }],
  };
  const snapshot = normalizeQueueSnapshot(payload, { now });

  assert.equal(queueRidesFromPayload(payload).length, 2);
  assert.equal(snapshot.byName.size, 2);
  assert.equal(snapshot.byName.get("abyssus").waitTime, 20);
  assert.equal(snapshot.byName.get("abyssus").name, "Abyssus (184)");
  assert.equal(snapshot.byName.get("formula").waitTime, 5);

  const onlyLands = normalizeQueueSnapshot({
    snapshot_generated_at: "2026-08-23T10:15:00.000Z",
    rides: [],
    lands: [{ rides: [checkedRide({ name: "Abyssus (184)", is_open: true, wait_time: 15 })] }],
  }, { now });
  assert.equal(onlyLands.byName.get("abyssus").waitTime, 15);
});

test("przy powtórzonym ID wygrywa nowszy rzeczywisty odczyt zamiast starego zamknięcia", () => {
  const snapshot = normalizeQueueSnapshot({
    snapshot_generated_at: "2026-08-23T10:20:00.000Z",
    rides: [{ id: 184, name: "Abyssus (184)", is_open: false, wait_time: 0, last_updated: "2026-08-23T07:00:00.000Z" }],
    lands: [{ rides: [checkedRide({ id: 184, name: "Abyssus (184)", is_open: true, wait_time: 22 })] }],
  }, { now });

  assert.equal(snapshot.byName.size, 1);
  assert.equal(snapshot.byName.get("abyssus").isOpen, true);
  assert.equal(snapshot.byName.get("abyssus").waitTime, 22);
});

test("dopasowuje numery atrakcji dodawane przez live API bez zmiany nazwy ekranowej", () => {
  const snapshot = normalizeQueueSnapshot({
    snapshot_generated_at: "2026-08-23T10:15:00.000Z",
    rides: [
      { name: "Abyssus (184)", is_open: true, wait_time: 25 },
      { name: "Formula (73)", is_open: true, wait_time: 10 },
      { name: "Honey Harbor (224)", is_open: true, wait_time: 0 },
    ].map(checkedRide),
  }, { now });

  assert.equal(queueForAttraction(ATTRACTIONS.find((item) => item.id === "abyssus"), snapshot).waitTime, 25);
  assert.equal(queueForAttraction(ATTRACTIONS.find((item) => item.id === "formula"), snapshot).waitTime, 10);
  assert.equal(queueForAttraction(ATTRACTIONS.find((item) => item.id === "honey-harbour"), snapshot).waitTime, 0);
});

test("oficjalny numer 34 bezpiecznie łączy RMF Dragon z Dragon, a nie z Dragon Adventure", () => {
  const rmfDragon = ATTRACTIONS.find((item) => item.id === "rmf-dragon");
  const snapshot = normalizeQueueSnapshot({
    snapshot_generated_at: "2026-08-23T10:15:00.000Z",
    rides: [
      { name: "Dragon Adventure (153)", is_open: true, wait_time: 45 },
      { name: "Dragon (34)", is_open: true, wait_time: 8 },
    ].map(checkedRide),
  }, { now });

  assert.equal(queueForAttraction(rmfDragon, snapshot).name, "Dragon (34)");
  assert.equal(queueForAttraction(rmfDragon, snapshot).waitTime, 8);

  const wrongDragon = normalizeQueueSnapshot({
    snapshot_generated_at: "2026-08-23T10:15:00.000Z",
    rides: [checkedRide({ name: "Dragon Adventure (153)", is_open: true, wait_time: 45 })],
  }, { now });
  assert.equal(queueForAttraction(rmfDragon, wrongDragon), null);
});

test("nieznany status lub czas nie udaje zamknięcia ani zerowej kolejki", () => {
  const snapshot = normalizeQueueSnapshot({
    snapshot_generated_at: "2026-08-23T10:15:00.000Z",
    rides: [
      { name: "Status nieznany", wait_time: null },
      { name: "Czas nieznany", is_open: true, wait_time: null },
      { name: "Zero", is_open: true, wait_time: 0 },
      { name: "Zamknięta", is_open: false, wait_time: 0 },
    ].map(checkedRide),
  }, { now });

  const unknown = snapshot.byName.get("status nieznany");
  const missingWait = snapshot.byName.get("czas nieznany");
  const zero = snapshot.byName.get("zero");
  const closed = snapshot.byName.get("zamknieta");
  assert.equal(unknown.isOpen, null);
  assert.equal(unknown.waitTime, null);
  assert.equal(queueLabel(unknown), "status nieznany");
  assert.equal(missingWait.waitTime, null);
  assert.equal(queueLabel(missingWait), "brak czasu");
  assert.equal(zero.waitTime, 0);
  assert.equal(queueLabel(zero), "bez czekania");
  assert.equal(closed.isOpen, false);
  assert.equal(closed.waitTime, null);
  assert.equal(queueLabel(closed), "zamknięta");
});

test("przeterminowana migawka zachowuje prawdziwą datę i nie potwierdza statusów", () => {
  const snapshot = normalizeQueueSnapshot({
    snapshot_generated_at: "2026-07-13T12:20:35.284Z",
    rides: [{ name: "Abyssus (184)", is_open: false, wait_time: 0 }],
  }, { now });
  const ride = snapshot.byName.get("abyssus");

  assert.equal(snapshot.updatedAt, Date.parse("2026-07-13T12:20:35.284Z"));
  assert.equal(snapshot.freshness, "stale");
  assert.equal(ride.reportedIsOpen, false);
  assert.equal(ride.isOpen, null);
  assert.equal(ride.waitTime, null);
  assert.equal(queueLabel(ride), "dane nieaktualne");
});

test("świeży snapshot nie odmładza starego albo nieudatowanego odczytu konkretnej atrakcji", () => {
  const snapshot = normalizeQueueSnapshot({
    snapshot_generated_at: "2026-08-23T10:20:00.000Z",
    rides: [
      { name: "Abyssus (184)", is_open: false, wait_time: 0, last_updated: "2026-08-23T07:00:00.000Z" },
      { name: "Formula (73)", is_open: true, wait_time: 40 },
      checkedRide({ name: "Dragon (34)", is_open: true, wait_time: 12 }),
    ],
  }, { now });
  const abyssus = snapshot.byName.get("abyssus");
  const formula = snapshot.byName.get("formula");
  const dragon = snapshot.byName.get("dragon");

  assert.equal(snapshot.freshness, "fresh");
  assert.equal(abyssus.freshness, "stale");
  assert.equal(abyssus.stale, true);
  assert.equal(abyssus.isOpen, null);
  assert.equal(queueLabel(abyssus), "dane nieaktualne");
  assert.equal(formula.freshness, "unknown");
  assert.equal(formula.isOpen, null);
  assert.equal(formula.waitTime, null);
  assert.equal(dragon.freshness, "fresh");
  assert.equal(dragon.waitTime, 12);
});

test("brak daty nie dostaje podstawionego teraz, a puste odpowiedzi są odrzucane", () => {
  const undated = normalizeQueueSnapshot({
    rides: [{ name: "Abyssus (184)", is_open: true, wait_time: 10 }],
  }, { now });

  assert.equal(undated.updatedAt, null);
  assert.equal(undated.freshness, "unknown");
  assert.equal(undated.byName.get("abyssus").isOpen, null);
  assert.equal(undated.byName.get("abyssus").waitTime, null);
  assert.throws(() => normalizeQueueSnapshot({ rides: [], lands: [{ rides: [] }] }, { now }), /żadnej rozpoznawalnej atrakcji/);
});
