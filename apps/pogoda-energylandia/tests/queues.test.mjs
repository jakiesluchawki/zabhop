import test from "node:test";
import assert from "node:assert/strict";
import { ATTRACTIONS } from "../src/parkData.js";
import { cautiousWait, queueForAttraction } from "../src/queues.js";

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
