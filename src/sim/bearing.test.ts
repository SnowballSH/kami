import { describe, expect, it } from "vitest";
import { blankBoard } from "../board/boards/blank";
import type { Stroke } from "../core/geometry";
import {
  drawingOf,
  enter,
  feetOf,
  idOf,
  line,
  RIGHT,
  rulingOf,
  runUntil,
  standsOn,
} from "./testSupport";

const board = blankBoard("sketchbook");

const suspensionBridge = (): readonly Stroke[] => [
  line({ x: 300, y: 5 }, { x: 800, y: 5 }),
  line({ x: 400, y: 5 }, { x: 400, y: -150 }),
  line({ x: 700, y: 5 }, { x: 700, y: -150 }),
  [
    ...line({ x: 400, y: -150 }, { x: 550, y: -80 }),
    ...line({ x: 550, y: -80 }, { x: 700, y: -150 }),
  ],
];

describe("load-bearing ink", () => {
  it("lets Alice walk the deck of a suspension bridge through its towers", () => {
    const sim = enter(board);
    sim.addDrawing(drawingOf("bridge", ...suspensionBridge()));
    sim.applyRuling(idOf("bridge"), rulingOf("solid"));
    sim.setWalkIntent(RIGHT);
    runUntil(sim, standsOn(0, 750));
    expect(feetOf(sim).x).toBeGreaterThan(750);
    expect(feetOf(sim).y).toBeCloseTo(0, 0);
  });

  it("still stops her at a wall drawn on its own", () => {
    const sim = enter(board);
    sim.addDrawing(drawingOf("wall", line({ x: 200, y: 5 }, { x: 200, y: -150 })));
    sim.applyRuling(idOf("wall"), rulingOf("solid"));
    sim.setWalkIntent(RIGHT);
    runUntil(sim, () => feetOf(sim).x > 250, 600);
    expect(feetOf(sim).x).toBeLessThan(200);
  });
});
