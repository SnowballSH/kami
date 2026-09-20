import { describe, expect, it } from "vitest";
import type { NoteId } from "../notes/types";
import { inEffectDomain } from "./effectDomains";
import { createRuleCompiler, resolvePhysics } from "./index";
import type { Rule, RuleEffect, RuleId } from "./types";

type Understood = readonly [says: string, effect: RuleEffect, gloss: string];

const tilt = (value: number): RuleEffect => ({ governs: "tilt", value });
const worldSpin = (value: number): RuleEffect => ({ governs: "worldSpin", value });
const rule = (id: string, createdAt: number, effect: RuleEffect): Rule => ({
  id: id as RuleId,
  noteId: `note-${id}` as NoteId,
  sourceText: id,
  position: { x: 0, y: 0 },
  createdAt,
  effect,
  explanation: id,
});

const UNDERSTOOD: readonly Understood[] = [
  ["tilt the world 90°", tilt(90), "the paper is turned 90°"],
  ["tilt the world 30 degrees", tilt(30), "the paper is turned 30°"],
  ["rotate the world 45 degrees", tilt(45), "the paper is turned 45°"],
  ["the world spins 90 degrees", tilt(90), "the paper is turned 90°"],
  ["turn the world upside down", tilt(180), "the paper is turned 180°"],
  ["the paper is upside down", tilt(180), "the paper is turned 180°"],
  ["the world is sideways", tilt(90), "the paper is turned 90°"],
  ["the world is tilted", tilt(30), "the paper is turned 30°"],
  ["the paper leans right", tilt(30), "the paper is turned 30°"],
  ["tilt the world to the left", tilt(-30), "the paper is turned -30°"],
  ["the world is upright", tilt(0), "the paper is upright"],
  ["set the world straight", tilt(0), "the paper is upright"],
  ["tilt the world 400 degrees", tilt(180), "the paper is turned 180° (capped)"],
  ["the world spins", worldSpin(15), "the paper turns at 15°/s"],
  ["make the world spin", worldSpin(15), "the paper turns at 15°/s"],
  ["the world spins slowly", worldSpin(5), "the paper turns at 5°/s"],
  ["the world spins fast", worldSpin(45), "the paper turns at 45°/s"],
  ["the world spins backwards", worldSpin(-15), "the paper turns at -15°/s"],
  ["spin the world counterclockwise", worldSpin(-15), "the paper turns at -15°/s"],
  ["the world rotates at 10 degrees per second", worldSpin(10), "the paper turns at 10°/s"],
  ["stop the world spinning", worldSpin(0), "the paper holds still"],
];

const LEFT_TO_OTHERS: readonly (readonly [says: string, governs: string])[] = [
  ["the wheel spins", "spin"],
  ["everything spins", "spin"],
  ["flip gravity", "gravity"],
  ["gravity sideways", "gravity"],
  ["the world is 30 degrees", "temperature"],
];

describe("laws on the paper", () => {
  const compiler = createRuleCompiler();

  it.each(UNDERSTOOD)("understands %j", async (says, effect, gloss) => {
    expect(await compiler.compile(says)).toEqual({ effect, explanation: gloss });
  });

  it.each(LEFT_TO_OTHERS)("leaves %j to the %s law", async (says, governs) => {
    expect((await compiler.compile(says))?.effect.governs).toBe(governs);
  });

  it("bounds the tilt to a half turn either way and the spin to a quarter turn a second", () => {
    expect(inEffectDomain("tilt", 180) && inEffectDomain("tilt", -180)).toBe(true);
    expect(inEffectDomain("tilt", 181)).toBe(false);
    expect(inEffectDomain("worldSpin", 90) && inEffectDomain("worldSpin", -90)).toBe(true);
    expect(inEffectDomain("worldSpin", 91)).toBe(false);
  });

  it("folds tilt and spin as two dials, later wins, and refolds without a repealed one", () => {
    const rules = [rule("a", 1, tilt(90)), rule("b", 2, worldSpin(5)), rule("c", 3, tilt(30))];
    const physics = resolvePhysics(rules);
    expect(physics.tilt).toBe(30);
    expect(physics.worldSpin).toBe(5);
    expect(physics.gravity).toEqual({ x: 0, y: 1 });
    const repealed = resolvePhysics(rules.filter(({ id }) => id !== "c"));
    expect(repealed.tilt).toBe(90);
  });
});
