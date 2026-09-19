import type { Nature } from "../cat/types";
import { clamp, type Vec } from "../core/geometry";
import { MARKER, mixRgb, NATURE_TINTS, type Rgb } from "./palette";

export const SHIVER_MS = 500;

const SHIVER_AMPLITUDE = 2.4;
const SHIVER_RADIANS_PER_MS = 0.085;
const SHIVER_DETUNE = 1.37;
const SETTLED = 1;

export const awakening = (nowMs: number, awakenedAtMs: number | null): number =>
  awakenedAtMs === null ? SETTLED : clamp((nowMs - awakenedAtMs) / SHIVER_MS, 0, SETTLED);

export const isSettled = (progress: number): boolean => progress >= SETTLED;

export const shiverOffset = (nowMs: number, progress: number): Vec => {
  const reach = SHIVER_AMPLITUDE * (SETTLED - progress);
  return {
    x: Math.sin(nowMs * SHIVER_RADIANS_PER_MS) * reach,
    y: Math.cos(nowMs * SHIVER_RADIANS_PER_MS * SHIVER_DETUNE) * reach,
  };
};

export const inkTint = (nature: Nature, progress: number): Rgb =>
  mixRgb(MARKER.black, NATURE_TINTS[nature], progress);
