import { describe, expect, it } from "vitest";
import type { NoteId } from "../notes/types";
import { createRuleCompiler, resolvePhysics } from "./index";
import { motionOf } from "./motion";
import { type Rule, type RuleEffect, type RuleId, STILL, type Target } from "./types";

type Understood = readonly [says: string, effect: RuleEffect, gloss: string];

const named = (name: string): Target => ({ kind: "named", name });
const heed = (of: Target, value: number): RuleEffect => ({ governs: "heed", of, value });
const rule = (id: string, createdAt: number, effect: RuleEffect): Rule => ({
  id: id as RuleId,
  noteId: `note-${id}` as NoteId,
  sourceText: id,
  position: { x: 0, y: 0 },
  createdAt,
  effect,
  explanation: id,
});

const FOLLOWS: readonly Understood[] = [
  ["the cat chases me", heed(named("cat"), 1), "the cat: follows Alice"],
  ["the cat follows me", heed(named("cat"), 1), "the cat: follows Alice"],
  ["the dog follows alice", heed(named("dog"), 1), "the dog: follows Alice"],
  ["The dog follows her everywhere.", heed(named("dog"), 1), "the dog: follows Alice"],
  ["the dog is loyal", heed(named("dog"), 1), "the dog: follows Alice"],
  ["the dog is my pet", heed(named("dog"), 1), "the dog: follows Alice"],
  ["the robot guards alice", heed(named("robot"), 1), "the robot: follows Alice"],
  ["the ghost is chasing us", heed(named("ghost"), 1), "the ghost: follows Alice"],
  ["everything follows me", heed({ kind: "all" }, 1), "everything: follows Alice"],
];

const FLEES: readonly Understood[] = [
  ["the mouse runs away from alice", heed(named("mouse"), -1), "the mouse: flees Alice"],
  ["the mouse runs away from her", heed(named("mouse"), -1), "the mouse: flees Alice"],
  ["the cat is scared of me", heed(named("cat"), -1), "the cat: flees Alice"],
  ["the bird is shy", heed(named("bird"), -1), "the bird: flees Alice"],
  ["the rabbit flees", heed(named("rabbit"), -1), "the rabbit: flees Alice"],
  ["the rabbit hides from alice", heed(named("rabbit"), -1), "the rabbit: flees Alice"],
];

const ALONE: readonly Understood[] = [
  ["the cat ignores me", heed(named("cat"), 0), "the cat: goes its own way"],
  ["the dog stops following me", heed(named("dog"), 0), "the dog: goes its own way"],
  ["the dog doesn't follow alice anymore", heed(named("dog"), 0), "the dog: goes its own way"],
  ["the cat leaves me alone", heed(named("cat"), 0), "the cat: goes its own way"],
  ["the cat is wild", heed(named("cat"), 0), "the cat: goes its own way"],
];

const LEFT_TO_OTHERS: readonly string[] = [
  "alice chases the cat",
  "alice follows the dog",
  "the dog follows the cat",
  "a loyal dog",
  "a shy mouse",
  "the cat",
  "the cat is fast",
  "follow me",
];

describe("heed laws", () => {
  const compiler = createRuleCompiler();

  it.each([...FOLLOWS, ...FLEES, ...ALONE])("reads %j", async (says, effect, gloss) => {
    expect(await compiler.compile(says)).toEqual({ effect, explanation: gloss });
  });

  it.each(LEFT_TO_OTHERS)("does not read %j as a heed law", async (says) => {
    expect((await compiler.compile(says))?.effect.governs).not.toBe("heed");
  });

  it("folds heed as a body law: the latest word on a creature wins, and repeal refolds", () => {
    const rules = [
      rule("a", 1, heed(named("cat"), -1)),
      rule("b", 2, heed(named("cat"), 1)),
      rule("c", 3, heed(named("dog"), -1)),
    ];
    const { bodies } = resolvePhysics(rules);
    expect(motionOf({}, bodies, "a cat")).toEqual({ ...STILL, heed: 1 });
    expect(motionOf({ heed: 1 }, bodies, "a dog")).toEqual({ ...STILL, heed: -1 });
    expect(motionOf({ heed: 1 }, bodies, "a duck")).toEqual({ ...STILL, heed: 1 });
    const repealed = resolvePhysics(rules.filter(({ id }) => id !== "b")).bodies;
    expect(motionOf({}, repealed, "a cat")).toEqual({ ...STILL, heed: -1 });
  });
});
