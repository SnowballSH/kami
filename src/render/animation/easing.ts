import { clamp } from "../../core/geometry";

/** Where a beat that started at `startedAtMs` and lasts `durationMs` is now, 0 to 1. */
export const progressOf = (nowMs: number, startedAtMs: number, durationMs: number): number =>
  clamp((nowMs - startedAtMs) / durationMs, 0, 1);

export const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

export const easeInCubic = (t: number): number => t ** 3;

export const easeInOutSine = (t: number): number => (1 - Math.cos(Math.PI * t)) / 2;

const BACK_OVERSHOOT = 1.70158;

/** Overshoots its target and settles back, the way a doodle pops onto the page. */
export const easeOutBack = (t: number): number => {
  const shifted = t - 1;
  return 1 + shifted * shifted * ((BACK_OVERSHOOT + 1) * shifted + BACK_OVERSHOOT);
};

/** Rises to 1 midway and comes back down to 0: an arc, or a passing bulge. */
export const arc = (t: number): number => Math.sin(Math.PI * t);
