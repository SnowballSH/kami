import { describe, expect, it } from "vitest";
import { blankBoard } from "../board/boards/blank";
import type { NoteId } from "../notes/types";
import { createRuleCompiler } from "../rules";
import { foldOver } from "../rules/resolvePhysics";
import { EARTH, type Rule, type RuleId } from "../rules/types";
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

  it.each([
    [{ glow: 1, heed: 1 }, true],
    [{ heed: 1 }, false],
  ])("lets a creature with %o that follows her carry the light along: %s", (motion, lit) => {
    const sim = enter(board);
    sim.setPhysics(PITCH_DARK);
    const from = feetOf(sim).x;
    sim.addDrawing(drawingOf("firefly", blob(from - 60, -10, 40, 30)));
    sim.applyRuling(idOf("firefly"), { ...rulingOf("walker"), motion });
    sim.setWalkIntent(RIGHT);
    runSteps(sim, 900);
    const walked = feetOf(sim).x - from;
    if (lit) expect(walked).toBeGreaterThan(LANTERN_LIGHT_PX * 2);
    else expect(walked).toBeCloseTo(0, 0);
    expect(sim.snapshot().drawings.find(({ id }) => id === idOf("firefly"))?.lit).toBe(lit);
  });

  it("lights whatever a law says glows, and unlights it when the law is taken back", () => {
    const sim = enter(board);
    sim.addDrawing(drawingOf("rock", blob(0, -10, 40, 30)));
    sim.applyRuling(idOf("rock"), { ...rulingOf("heavy"), name: "a rock" });
    const litNow = () => sim.snapshot().drawings.find(({ id }) => id === idOf("rock"))?.lit;
    expect(litNow()).toBe(false);
    sim.setPhysics({
      ...PITCH_DARK,
      bodies: [{ of: { kind: "named", name: "rock" }, edit: { glow: 1 } }],
    });
    expect(litNow()).toBe(true);
    sim.setPhysics(PITCH_DARK);
    expect(litNow()).toBe(false);
  });

  it("puts out a lantern a law says stops glowing, and relights it when the law is erased", () => {
    const sim = enter(board);
    sim.addDrawing(drawingOf("lamp", blob(0, -120, 40, 40)));
    sim.applyRuling(idOf("lamp"), { ...rulingOf("lantern"), name: "a lamp" });
    const litNow = () => sim.snapshot().drawings.find(({ id }) => id === idOf("lamp"))?.lit;
    sim.setPhysics(PITCH_DARK);
    expect(litNow()).toBe(true);
    sim.setPhysics({
      ...PITCH_DARK,
      bodies: [{ of: { kind: "named", name: "lamp" }, edit: { glow: 0 } }],
    });
    expect(litNow()).toBe(false);
    sim.setPhysics(PITCH_DARK);
    expect(litNow()).toBe(true);
  });

  it("keeps a lantern lit under a law about some other drawing", () => {
    const sim = enter(board);
    sim.addDrawing(drawingOf("lamp", blob(0, -120, 40, 40)));
    sim.applyRuling(idOf("lamp"), { ...rulingOf("lantern"), name: "a lamp" });
    sim.setPhysics({
      ...PITCH_DARK,
      bodies: [{ of: { kind: "named", name: "rock" }, edit: { glow: 0 } }],
    });
    expect(sim.snapshot().drawings.find(({ id }) => id === idOf("lamp"))?.lit).toBe(true);
  });

  it.each([
    ["the lamp glows normally", true],
    ["the lamp glows as usual", true],
    ["the lamp stops glowing", false],
  ])("under the law %j, a lantern is lit: %s", async (says, lit) => {
    const compiled = await createRuleCompiler().compile(says);
    if (compiled === null) throw new Error(`not a law: ${says}`);
    const law: Rule = {
      ...compiled,
      id: "law" as RuleId,
      sourceText: says,
      noteId: "note" as NoteId,
      position: { x: 0, y: 0 },
      createdAt: 0,
    };
    const sim = enter(board);
    sim.addDrawing(drawingOf("lamp", blob(0, -120, 40, 40)));
    sim.applyRuling(idOf("lamp"), { ...rulingOf("lantern"), name: "a lamp" });
    sim.setPhysics(foldOver(PITCH_DARK, [law]));
    expect(sim.snapshot().drawings.find(({ id }) => id === idOf("lamp"))?.lit).toBe(lit);
  });
});
