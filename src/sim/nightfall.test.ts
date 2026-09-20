import { describe, expect, it } from "vitest";
import { blankBoard } from "../board/boards/blank";
import { EARTH } from "../rules/types";
import { LANTERN_LIGHT_PX } from "./constants";
import {
  blob,
  drawingOf,
  enter,
  feetOf,
  idOf,
  RIGHT,
  rulingOf,
  runSteps,
  typesOf,
} from "./testSupport";

const board = blankBoard("night");
const PITCH_DARK = { ...EARTH, daylight: 0 };

describe("pitch dark", () => {
  it("keeps her where she stands, saying so once, until daylight returns", () => {
    const sim = enter(board);
    sim.setPhysics(PITCH_DARK);
    sim.setWalkIntent(RIGHT);
    const from = feetOf(sim).x;
    const events = runSteps(sim, 120);
    expect(typesOf(events).filter((type) => type === "in-the-dark")).toHaveLength(1);
    expect(feetOf(sim).x).toBeCloseTo(from, 3);

    sim.setPhysics({ ...EARTH, daylight: 0.5 });
    runSteps(sim, 60);
    expect(feetOf(sim).x).toBeGreaterThan(from + 50);
  });

  it("lets her walk as far as a lantern's light reaches", () => {
    const sim = enter(board);
    sim.setPhysics(PITCH_DARK);
    const from = feetOf(sim).x;
    sim.addDrawing(drawingOf("lamp", blob(from + 100, -120, 40, 40)));
    sim.applyRuling(idOf("lamp"), rulingOf("lantern"));
    sim.setWalkIntent(RIGHT);
    runSteps(sim, 600);
    const walked = feetOf(sim).x - from;
    expect(walked).toBeGreaterThan(200);
    expect(walked).toBeLessThan(100 + LANTERN_LIGHT_PX + 40);
  });
});
