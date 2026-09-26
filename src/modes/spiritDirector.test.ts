import { describe, expect, it } from "vitest";
import { boardFor } from "../board";
import type { Ruling } from "../cat/types";
import type { DrawingId } from "../ink/types";
import { namesABody } from "./bodyNames";
import { BODY_NAMES, BOSS_MODE, SPIRIT_MODE } from "./modes";
import { SpiritDirector } from "./spiritDirector";

const ruling = (name: string): Ruling => ({ name, nature: "ink", strength: 1, tags: [], line: "" });
const D1 = "d1" as DrawingId;
const D2 = "d2" as DrawingId;

const spiritDirector = (): SpiritDirector =>
  new SpiritDirector(SPIRIT_MODE, { kind: "drawn", names: BODY_NAMES });
const bossDirector = (): SpiritDirector =>
  new SpiritDirector(BOSS_MODE, { kind: "drawn", names: BODY_NAMES });

describe("what names a body", () => {
  it("takes the mode's own names, pronouns for the player, and any body noun", () => {
    for (const name of [
      "alice",
      "Alice!",
      "me",
      "her",
      "a girl",
      "the knight",
      "my robot",
      "a cat",
    ])
      expect(namesABody(name, BODY_NAMES)).toBe(true);
    expect(namesABody("this is me", BODY_NAMES)).toBe(true);
    expect(namesABody("a little stick figure", BODY_NAMES)).toBe(true);
  });

  it("does not take things, places or laws for a body", () => {
    for (const name of ["a sword", "a hammer", "the moon", "a bouncy mushroom", "", "   "])
      expect(namesABody(name, BODY_NAMES)).toBe(false);
  });

  it.each([
    ["a cat", true],
    ["my knight", true],
    ["stick man", true],
    ["a stickman", true],
    ["a tall girl", true],
    ["alice", true],
    ["a cat girl", true],
    ["two little robots", true],
    ["the girl with the red hat", true],
    ["a king of the hill", true],
    ["the rabbit hole", false],
    ["a bear trap", false],
    ["a spider web", false],
    ["the dog house", false],
    ["a bird cage", false],
    ["a fish bowl", false],
    ["a bee hive", false],
    ["a monster truck", false],
    ["a robot arm", false],
    ["a bag of cats", false],
    ["a picture of me", false],
  ])("reads %j by its head noun: a body is %s", (name, body) => {
    expect(namesABody(name, BODY_NAMES)).toBe(body);
  });
});

describe("the spirit director", () => {
  it("opens as a spirit and stays one while nothing is named as a body", () => {
    const director = spiritDirector();
    expect(director.open(boardFor("wonderland")).kind).toBe("spirit");
    expect(director.named(D1, ruling("a sword"))).toEqual([]);
    expect(director.witness({ type: "fell", who: 0 })).toEqual([]);
    expect(director.state.kind).toBe("spirit");
  });

  it("incarnates the first drawing named as a body, and only that one", () => {
    const director = spiritDirector();
    director.open(boardFor("wonderland"));
    expect(director.named(D1, ruling("alice"))).toEqual([
      { kind: "incarnated", by: "drawing", drawingId: D1, name: "alice" },
    ]);
    expect(director.state).toEqual({ kind: "body" });
    expect(director.named(D2, ruling("me"))).toEqual([]);
  });

  it("is unmade when the body falls, is devoured or its heart is swallowed, and is a spirit again", () => {
    for (const [event, cause] of [
      [{ type: "fell", who: 0 }, "fell"],
      [{ type: "alice-devoured", who: 0 }, "devoured"],
      [{ type: "heart-swallowed" }, "swallowed"],
    ] as const) {
      const director = spiritDirector();
      director.open(boardFor("wonderland"));
      director.named(D1, ruling("her"));
      expect(director.witness(event)).toEqual([{ kind: "unmade", cause }]);
      expect(director.state.kind).toBe("spirit");
      expect(director.witness(event)).toEqual([]);
    }
  });

  it("a twin falling or being devoured does not unmake her: the heart is in her own body", () => {
    const director = spiritDirector();
    director.open(boardFor("wonderland"));
    director.named(D1, ruling("her"));
    expect(director.witness({ type: "fell", who: 1 })).toEqual([]);
    expect(director.witness({ type: "alice-devoured", who: 2 })).toEqual([]);
    expect(director.state).toEqual({ kind: "body" });
  });

  it("wins the spirit room at the goal, and a boss room when the tear closes", () => {
    expect(spiritDirector().won({ type: "goal-reached", who: 0 })).toBe(true);
    expect(spiritDirector().won({ type: "tear-closed" })).toBe(false);
    expect(bossDirector().won({ type: "tear-closed" })).toBe(true);
    expect(bossDirector().won({ type: "goal-reached", who: 0 })).toBe(false);
  });

  it("opens the tear once a boss room's body is drawn", () => {
    const director = bossDirector();
    director.open(boardFor("wonderland"));
    expect(director.named(D1, ruling("a brave knight"))).toEqual([
      { kind: "incarnated", by: "drawing", drawingId: D1, name: "a brave knight" },
      { kind: "tear-opens" },
    ]);
  });

  it("forbids autopilot in both spirit and boss rooms", () => {
    expect(SPIRIT_MODE.autopilot).toBe("forbidden");
    expect(BOSS_MODE.autopilot).toBe("forbidden");
    expect(BOSS_MODE.loss).toEqual({ kind: "board-restarts" });
    expect(BOSS_MODE.card.roles).toHaveLength(2);
  });
});
