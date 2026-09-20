import { describe, expect, it } from "vitest";
import { blankBoard } from "../board/boards/blank";
import type { NoteId } from "../notes/types";
import { resolvePhysics } from "../rules";
import { EARTH, type Rule, type RuleEffect, type RuleId } from "../rules/types";
import {
  blob,
  drawingOf,
  enter,
  idOf,
  LEFT,
  line,
  RIGHT,
  rulingOf,
  runSteps,
  runUntil,
  saw,
} from "./testSupport";
import type { SimEvent, Simulation } from "./types";

const board = blankBoard("sketchbook");
const GROUND = board.spawn.y;

const law = (id: string, createdAt: number, effect: RuleEffect): Rule => ({
  id: id as RuleId,
  noteId: `note-${id}` as NoteId,
  sourceText: id,
  position: { x: 0, y: 0 },
  createdAt,
  effect,
  explanation: id,
});

const withTwin = (): Simulation => {
  const sim = enter(board);
  sim.setPhysics({ ...EARTH, clones: 1 });
  runSteps(sim, 30);
  return sim;
};

const centreX = (sim: Simulation, who: number): number => {
  const { x, width } = sim.aliceBounds(who);
  return x + width / 2;
};

const eventsAbout = (events: readonly SimEvent[], type: SimEvent["type"]) =>
  events.filter((event) => event.type === type);

describe("independent Alices", () => {
  it("walk their own ways: each hears only her own intent", () => {
    const sim = withTwin();
    const before = [centreX(sim, 0), centreX(sim, 1)];
    sim.setWalkIntent(RIGHT, 0);
    sim.setWalkIntent(LEFT, 1);
    runSteps(sim, 60);
    expect(centreX(sim, 0) - (before[0] ?? 0)).toBeGreaterThan(50);
    expect(centreX(sim, 1) - (before[1] ?? 0)).toBeLessThan(-50);
  });

  it("win the room when any one of them reaches the goal, and say which", () => {
    const sim = withTwin();
    const flagX = centreX(sim, 1) - 150;
    sim.addDrawing(
      drawingOf("flag", line({ x: flagX, y: GROUND - 80 }, { x: flagX, y: GROUND - 6 })),
    );
    sim.applyRuling(idOf("flag"), rulingOf("goal"));
    sim.setWalkIntent(LEFT, 1);
    const events = runUntil(sim, saw("goal-reached"), 240);
    expect(eventsAbout(events, "goal-reached")).toEqual([{ type: "goal-reached", who: 1 }]);
  });

  it("sends back only the one who fell, and leaves the other where she stands", () => {
    const sim = withTwin();
    const lavaX = centreX(sim, 1) - 120;
    sim.addDrawing(drawingOf("lava", blob(lavaX, GROUND - 5, 60, 30)));
    sim.applyRuling(idOf("lava"), rulingOf("hazard"));
    const aliceAt = centreX(sim, 0);
    sim.setWalkIntent(LEFT, 1);
    const events = runUntil(sim, saw("fell"), 300);
    expect(eventsAbout(events, "fell")).toEqual([{ type: "fell", who: 1 }]);
    expect(centreX(sim, 1)).toBeCloseTo(board.spawn.x, 0);
    expect(centreX(sim, 0)).toBeCloseTo(aliceAt, 0);
  });

  it("refuses to name an Alice who is not on the board", () => {
    const sim = withTwin();
    expect(() => sim.aliceBounds(2)).toThrow(RangeError);
    expect(sim.alices()).toHaveLength(2);
  });

  it("keep the clones law exactly as written: fold to the newest count, repeal back", () => {
    const one = law("clone-alice", 100, { governs: "clones", value: 1 });
    const three = law("three-clones", 200, { governs: "clones", value: 3 });
    const sim = enter(board);
    for (const [laws, count] of [
      [[one], 1],
      [[one, three], 3],
      [[three, one], 3],
      [[one], 1],
      [[], 0],
    ] as const) {
      sim.setPhysics(resolvePhysics([...laws]));
      expect(resolvePhysics([...laws]).clones).toBe(count);
      expect(sim.alices()).toHaveLength(count + 1);
      expect(sim.snapshot().twins).toHaveLength(count);
    }
  });
});
