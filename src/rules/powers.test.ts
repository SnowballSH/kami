import { describe, expect, it } from "vitest";
import type { NoteId } from "../notes/types";
import { inEffectDomain } from "./effectDomains";
import { createRuleCompiler, resolvePhysics } from "./index";
import { motionOf } from "./motion";
import { type Rule, type RuleEffect, type RuleId, STILL, type Target } from "./types";

type Understood = readonly [says: string, effect: RuleEffect, gloss: string];

const named = (name: string): Target => ({ kind: "named", name });
const ALL: Target = { kind: "all" };
const pace = (of: Target, value: number): RuleEffect => ({ governs: "pace", of, value });
const wings = (of: Target, value: number): RuleEffect => ({ governs: "wings", of, value });
const size = (of: Target, value: number): RuleEffect => ({ governs: "size", of, value });
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
  ["the dog can fly", wings(named("dog"), 1), "the dog: can fly"],
  ["the dog flies", wings(named("dog"), 1), "the dog: can fly"],
  ["make the dog fly", wings(named("dog"), 1), "the dog: can fly"],
  ["let the cat fly", wings(named("cat"), 1), "the cat: can fly"],
  ["the rock floats", wings(named("rock"), 1), "the rock: can fly"],
  ["the dog cannot fly anymore", wings(named("dog"), 0), "the dog: grounded"],
  ["the cat is twice as fast", pace(named("cat"), 2), "the cat: pace = 2x"],
  ["the cat is quick", pace(named("cat"), 2), "the cat: pace = 2x"],
  ["the dog runs faster", pace(named("dog"), 2), "the dog: pace = 2x"],
  ["every cat is faster", pace(named("cat"), 2), "the cat: pace = 2x"],
  ["the dog is slow", pace(named("dog"), 0.5), "the dog: pace = 0.5x"],
  ["the cat is 10 times faster", pace(named("cat"), 5), "the cat: pace = 5x (capped)"],
  ["the rabbit is huge", size(named("rabbit"), 2), "the rabbit: size = 2x"],
  ["the mouse grows", size(named("mouse"), 2), "the mouse: size = 2x"],
  ["the rabbit is 3 times bigger", size(named("rabbit"), 3), "the rabbit: size = 3x"],
  ["the rabbit is tiny", size(named("rabbit"), 0.5), "the rabbit: size = 0.5x"],
  ["everything is huge", size(ALL, 2), "everything: size = 2x"],
];

const LEFT_TO_OTHERS: readonly (readonly [says: string, governs: RuleEffect["governs"]])[] = [
  ["alice can fly", "flight"],
  ["alice walks twice as fast", "walkSpeed"],
  ["alice is huge", "aliceSize"],
  ["the wheel spins fast", "spin"],
  ["the rock is massive", "mass"],
  ["the rock is heavier", "mass"],
];

describe("powers a drawing can gain by law", () => {
  const compiler = createRuleCompiler();

  it.each(UNDERSTOOD)("understands %j", async (says, effect, gloss) => {
    expect(await compiler.compile(says)).toEqual({ effect, explanation: gloss });
  });

  it.each(LEFT_TO_OTHERS)("leaves %j to the %s law", async (says, governs) => {
    expect((await compiler.compile(says))?.effect.governs).toBe(governs);
  });

  it("leaves a name that only describes a drawing to the Cat", async () => {
    expect(await compiler.compile("a flying dog")).toBeNull();
    expect(await compiler.compile("a giant rabbit")).toBeNull();
  });

  it("bounds pace, wings and size like Alice's own dials", () => {
    expect(inEffectDomain("pace", 0.1) && inEffectDomain("pace", 5)).toBe(true);
    expect(inEffectDomain("pace", 0)).toBe(false);
    expect(inEffectDomain("wings", 0) && inEffectDomain("wings", 1)).toBe(true);
    expect(inEffectDomain("wings", 2)).toBe(false);
    expect(inEffectDomain("size", 0.25) && inEffectDomain("size", 4)).toBe(true);
    expect(inEffectDomain("size", 5)).toBe(false);
  });

  it("reaches the drawing a plural or a model's capitalised phrase names", async () => {
    const buses = await compiler.compile("the buses are fast");
    const hole = pace({ kind: "named", name: "Black Hole" }, 3);
    const rules = [rule("a", 1, buses?.effect ?? pace(ALL, 1)), rule("b", 2, hole)];
    const { bodies } = resolvePhysics(rules);
    expect(motionOf({}, bodies, "a bus").pace).toBe(2);
    expect(motionOf({}, bodies, "a black hole").pace).toBe(3);
    expect(motionOf({}, bodies, "a hole").pace).toBe(1);
  });

  it("folds powers as body laws, later wins per drawing, and refolds without a repealed one", () => {
    const rules = [
      rule("a", 1, wings(named("dog"), 1)),
      rule("b", 2, pace(named("cat"), 2)),
      rule("c", 3, size(ALL, 2)),
      rule("d", 4, size(named("cat"), 0.5)),
    ];
    const { bodies } = resolvePhysics(rules);
    expect(motionOf({}, bodies, "a dog")).toEqual({ ...STILL, wings: 1, size: 2 });
    expect(motionOf({}, bodies, "the cat")).toEqual({ ...STILL, pace: 2, size: 0.5 });
    expect(motionOf({}, bodies, "a rock")).toEqual({ ...STILL, size: 2 });
    const repealed = resolvePhysics(rules.filter(({ id }) => id !== "d")).bodies;
    expect(motionOf({}, repealed, "the cat")).toEqual({ ...STILL, pace: 2, size: 2 });
  });
});
