import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrawnBody } from "../sim/body/types";
import type { AliceSnapshot } from "../sim/types";
import { paintDrawnAlice } from "./bossPainter";

let pathsBuilt = 0;

class CountingPath2D {
  constructor() {
    pathsBuilt += 1;
  }
  moveTo(): void {}
  arc(): void {}
  quadraticCurveTo(): void {}
  closePath(): void {}
}

const ctx = new Proxy({} as CanvasRenderingContext2D, {
  get: () => () => {},
  set: () => true,
});

const body: DrawnBody = {
  strokes: [0, 10].map((shift) => ({
    stroke: Array.from({ length: 10 }, (_, index) => ({ x: index * 3 + shift, y: index })),
    part: "torso",
    sinceMs: -1e6,
  })),
  heart: { x: 0, y: 0 },
  frame: { width: 40, height: 80 },
  fullest: { head: 0, torso: 1, arms: 0, legs: 0, wings: 0 },
};

const drawnAlice = (clockMs: number) =>
  ({
    center: { x: 0, y: 0 },
    height: 80,
    facing: 1,
    look: {
      kind: "drawn",
      body,
      scale: 1,
      clockMs,
      abilities: { walk: true, jump: true, climb: false, fly: false, see: true },
    },
  }) as unknown as AliceSnapshot;

beforeEach(() => {
  pathsBuilt = 0;
  vi.stubGlobal("Path2D", CountingPath2D);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("paintDrawnAlice", () => {
  it("builds her body's path once while its strokes stay the same", () => {
    paintDrawnAlice(ctx, drawnAlice(0), 0);
    paintDrawnAlice(ctx, drawnAlice(16), 16);
    paintDrawnAlice(ctx, drawnAlice(32), 32);
    expect(pathsBuilt).toBe(1);
  });
});
