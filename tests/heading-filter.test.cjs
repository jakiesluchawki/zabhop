const assert = require("node:assert/strict");
const test = require("node:test");
const { HeadingFilter, unwrapAngle } = require("../heading-filter.js");

test("filters compass noise inside the deadband", () => {
  const filter = new HeadingFilter();
  assert.equal(filter.update(100, 0, 8), 100);
  assert.equal(filter.update(101.2, 0.1, 8), null);
  assert.equal(filter.value, 100);
});

test("moves through north by the short circular path", () => {
  const filter = new HeadingFilter({ spikeThreshold: 90 });
  assert.equal(filter.update(358, 0, 5), 358);
  const next = filter.update(2, 0.1, 5);
  assert.ok(next > 358 || next < 3);
  assert.ok(Math.abs(((next - 358 + 540) % 360) - 180) < 4);
});

test("rejects one implausible spike and accepts a confirmed turn", () => {
  const filter = new HeadingFilter();
  assert.equal(filter.update(20, 0, 6), 20);
  assert.equal(filter.update(148, 0.1, 6), null);
  assert.equal(filter.value, 20);
  const confirmed = filter.update(152, 0.2, 6);
  assert.ok(confirmed > 20 && confirmed < 152);
});

test("ignores headings whose reported accuracy is unusable", () => {
  const filter = new HeadingFilter();
  assert.equal(filter.update(30, 0, 8), 30);
  assert.equal(filter.update(80, 0.1, 80), null);
  assert.equal(filter.value, 30);
});

test("restarts from a fresh reading after the app was suspended", () => {
  const filter = new HeadingFilter();
  assert.equal(filter.update(30, 0, 8), 30);
  assert.equal(filter.update(210, 2, 8), 210);
});

test("unwraps visual rotation without a 360 degree flip", () => {
  assert.equal(unwrapAngle(359, 1), 361);
  assert.equal(unwrapAngle(-179, 179), -181);
});
