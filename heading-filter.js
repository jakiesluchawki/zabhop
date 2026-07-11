(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ZabHopHeading = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  function normalizeDegrees(value) {
    return ((value % 360) + 360) % 360;
  }

  function signedAngle(value) {
    return ((value + 540) % 360) - 180;
  }

  function unwrapAngle(current, target) {
    if (!Number.isFinite(current)) return signedAngle(target);
    return current + signedAngle(target - current);
  }

  class HeadingFilter {
    constructor(options = {}) {
      this.deadband = options.deadband ?? 2;
      this.maxAccuracy = options.maxAccuracy ?? 35;
      this.minimumInterval = options.minimumInterval ?? 0.05;
      this.spikeThreshold = options.spikeThreshold ?? 52;
      this.spikeAgreement = options.spikeAgreement ?? 18;
      this.spikeWindow = options.spikeWindow ?? 0.4;
      this.value = null;
      this.lastTimestamp = null;
      this.pendingSpike = null;
      this.rapidModeUntil = 0;
    }

    reset() {
      this.value = null;
      this.lastTimestamp = null;
      this.pendingSpike = null;
      this.rapidModeUntil = 0;
    }

    update(rawHeading, timestampSeconds, accuracy) {
      if (!Number.isFinite(rawHeading) || !Number.isFinite(timestampSeconds)) return null;
      if (Number.isFinite(accuracy) && accuracy >= 0 && accuracy > this.maxAccuracy) return null;

      const raw = normalizeDegrees(rawHeading);
      if (this.value == null) {
        this.value = raw;
        this.lastTimestamp = timestampSeconds;
        return this.value;
      }

      const elapsed = Math.max(0, timestampSeconds - this.lastTimestamp);
      if (elapsed > 1.2) {
        this.value = raw;
        this.lastTimestamp = timestampSeconds;
        this.pendingSpike = null;
        this.rapidModeUntil = 0;
        return this.value;
      }
      if (elapsed < this.minimumInterval) return null;
      this.lastTimestamp = timestampSeconds;

      const delta = signedAngle(raw - this.value);
      if (Math.abs(delta) <= this.deadband) {
        this.pendingSpike = null;
        return null;
      }

      if (Math.abs(delta) >= this.spikeThreshold && timestampSeconds > this.rapidModeUntil) {
        const confirmed = this.pendingSpike
          && timestampSeconds - this.pendingSpike.timestamp <= this.spikeWindow
          && Math.abs(signedAngle(raw - this.pendingSpike.heading)) <= this.spikeAgreement;

        if (!confirmed) {
          this.pendingSpike = { heading: raw, timestamp: timestampSeconds };
          return null;
        }

        this.pendingSpike = null;
        this.rapidModeUntil = timestampSeconds + 0.55;
      } else {
        this.pendingSpike = null;
      }

      const dt = Math.min(Math.max(elapsed, 1 / 60), 0.25);
      const angularSpeed = Math.abs(delta) / dt;
      const timeConstant = angularSpeed > 120 ? 0.12 : angularSpeed > 45 ? 0.2 : 0.38;
      const alpha = 1 - Math.exp(-dt / timeConstant);
      this.value = normalizeDegrees(this.value + delta * alpha);
      return this.value;
    }
  }

  return { HeadingFilter, normalizeDegrees, signedAngle, unwrapAngle };
});
