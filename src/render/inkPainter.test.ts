import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Stroke } from "../core/geometry";
import type { Drawing, DrawingId } from "../ink/types";
import { InkPainter } from "./inkPainter";
import type { InkView } from "./types";

let pathsBuilt = 0;

class CountingPath2D {
  constructor() {
    pathsBuilt += 1;
  }
  moveTo(): void {}
  lineTo(): void {}
  arc(): void {}
  quadraticCurveTo(): void {}
  closePath(): void {}
}

const ctx = new Proxy({} as CanvasRenderingContext2D, {
  get: () => () => {},
  set: () => true,
});

const VIEW = { x: -1_000, y: -1_000, width: 2_000, height: 2_000 };
const POSE = { origin: { x: 0, y: 0 }, position: { x: 0, y: 0 }, angle: 0, scale: 1 };
const FAR_POSE = { ...POSE, position: { x: 1e6, y: 1e6 } };

const wave = (shift: number): Stroke =>
  Array.from({ length: 20 }, (_, index) => ({ x: index * 4 + shift, y: Math.sin(index) * 10 }));

const inkOf = (id: string, pose = POSE): InkView => ({
  drawing: { id: id as DrawingId, strokes: [wave(0), wave(8)], cost: 1 } as unknown as Drawing,
  pose,
  nature: "ink",
  awakenedAtMs: null,
});

const paintFrame = (painter: InkPainter, inks: readonly InkView[], nowMs: number): void => {
  painter.paintInks(ctx, inks, VIEW, nowMs);
  painter.retain(new Set(inks.map(({ drawing }) => drawing.id)));
};

beforeEach(() => {
  pathsBuilt = 0;
  vi.stubGlobal("Path2D", CountingPath2D);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InkPainter path cache", () => {
  it("builds no paths while a vehicle is painted over its rider", () => {
    const painter = new InkPainter();
    const inks = Array.from({ length: 12 }, (_, index) => inkOf(`d${index}`));
    const vehicle = inks[5] as InkView;
    paintFrame(painter, inks, 0);
    pathsBuilt = 0;

    for (let frame = 1; frame <= 10; frame += 1) {
      paintFrame(painter, inks, frame);
      painter.paintOver(ctx, vehicle, VIEW, frame);
    }

    expect(pathsBuilt).toBe(0);
  });

  it("evicts an erased drawing even when another is added in the same frame", () => {
    const painter = new InkPainter();
    const kept = inkOf("kept");
    const erased = inkOf("erased");
    paintFrame(painter, [kept, erased], 0);
    paintFrame(painter, [kept, inkOf("added")], 1);
    pathsBuilt = 0;

    paintFrame(painter, [kept, erased], 2);

    expect(pathsBuilt).toBe(1);
  });

  it("builds no path for ink off screen", () => {
    const painter = new InkPainter();

    paintFrame(painter, [inkOf("far", FAR_POSE)], 0);

    expect(pathsBuilt).toBe(0);
  });
});
