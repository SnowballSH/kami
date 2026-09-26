import { describe, expect, it } from "vitest";
import { boardFor } from "../board";
import type { Ruling } from "../cat/types";
import type { DrawingId } from "../ink/types";
import { createDirector, EmbodiedDirector } from "./embodiedDirector";
import { BOSS_MODE, EMBODIED_MODE, GAME_MODES, modeFor, SPIRIT_MODE } from "./modes";
import { allowsLaw, naturesAllowed, opensWithAlice } from "./policy";
import { SpiritDirector } from "./spiritDirector";
import type { GameMode } from "./types";

const A_RULING: Ruling = {
  name: "a cat",
  nature: "walker",
  strength: 1,
  tags: [],
  line: "Off it goes.",
};

describe("the game modes", () => {
  it("are found by id, and an unknown id plays as embodied", () => {
    expect(modeFor("spirit")).toBe(SPIRIT_MODE);
    expect(modeFor("embodied")).toBe(EMBODIED_MODE);
    expect(modeFor("nonsense")).toBe(EMBODIED_MODE);
  });

  it("have distinct ids and a title card each", () => {
    expect(new Set(GAME_MODES.map((mode) => mode.id)).size).toBe(GAME_MODES.length);
    for (const mode of GAME_MODES) {
      expect(mode.card.title).not.toBe("");
      expect(mode.card.tagline).not.toBe("");
      expect(mode.card.opening).not.toBe("");
    }
  });

  it("today's play opens with a body that respawns and may walk itself", () => {
    expect(EMBODIED_MODE.opening).toEqual({ player: "body", freshPage: false });
    expect(EMBODIED_MODE.loss).toEqual({ kind: "respawn" });
    expect(EMBODIED_MODE.autopilot).toBe("allowed");
    expect(opensWithAlice(EMBODIED_MODE)).toBe(true);
  });

  it("the spirit mode opens with nobody on the board until she is drawn, and loses the body rather than respawning", () => {
    expect(SPIRIT_MODE.opening.player).toBe("spirit");
    expect(opensWithAlice(SPIRIT_MODE)).toBe(false);
    if (SPIRIT_MODE.opening.player === "spirit") {
      expect(SPIRIT_MODE.opening.incarnation.kind).toBe("drawn");
    }
    expect(SPIRIT_MODE.loss).toEqual({ kind: "unmade" });
  });
});

describe("mode policies", () => {
  it("allow every dial under `all`, listed ones under `only`, all but listed under `except`", () => {
    expect(allowsLaw({ kind: "all" }, "clones")).toBe(true);
    expect(allowsLaw({ kind: "only", dials: ["gravity"] }, "gravity")).toBe(true);
    expect(allowsLaw({ kind: "only", dials: ["gravity"] }, "clones")).toBe(false);
    expect(allowsLaw({ kind: "except", dials: ["clones"] }, "clones")).toBe(false);
    expect(allowsLaw({ kind: "except", dials: ["clones"] }, "gravity")).toBe(true);
  });

  it("narrow a room's natures by the mode's, never widening them", () => {
    const strict: GameMode = { ...EMBODIED_MODE, natures: ["bouncy", "climbable"] };
    expect(naturesAllowed(EMBODIED_MODE, "all")).toBe("all");
    expect(naturesAllowed(EMBODIED_MODE, ["bouncy"])).toEqual(["bouncy"]);
    expect(naturesAllowed(strict, "all")).toEqual(["bouncy", "climbable"]);
    expect(naturesAllowed(strict, ["climbable", "floaty"])).toEqual(["climbable"]);
  });
});

describe("the embodied director", () => {
  it("is the director for any mode that opens with a body; spirit openings get the spirit director", () => {
    expect(createDirector(EMBODIED_MODE)).toBeInstanceOf(EmbodiedDirector);
    expect(createDirector(SPIRIT_MODE)).toBeInstanceOf(SpiritDirector);
    expect(createDirector(BOSS_MODE)).toBeInstanceOf(SpiritDirector);
  });

  it("opens as a body, never changes it, and wins on the goal", () => {
    const director = new EmbodiedDirector(EMBODIED_MODE);
    expect(director.open(boardFor("wonderland"))).toEqual({ kind: "body" });
    expect(director.witness({ type: "fell", who: 0 })).toEqual([]);
    expect(director.named("d1" as DrawingId, A_RULING)).toEqual([]);
    expect(director.won({ type: "fell", who: 0 })).toBe(false);
    expect(director.won({ type: "goal-reached", who: 0 })).toBe(true);
    expect(director.state).toEqual({ kind: "body" });
  });

  it("unmakes her when she is devoured only where the mode's loss is not a respawn, and never for a fall", () => {
    const devoured = { type: "alice-devoured", who: 0 } as const;
    const restarting = new EmbodiedDirector({ ...EMBODIED_MODE, loss: { kind: "board-restarts" } });
    expect(new EmbodiedDirector(EMBODIED_MODE).witness(devoured)).toEqual([]);
    expect(restarting.witness(devoured)).toEqual([{ kind: "unmade", cause: "devoured" }]);
    expect(restarting.witness({ type: "alice-devoured", who: 1 })).toEqual([]);
    expect(restarting.witness({ type: "fell", who: 0 })).toEqual([]);
  });

  it("does not call an endless game won at the rabbit hole", () => {
    const sandbox = new EmbodiedDirector({ ...EMBODIED_MODE, win: { kind: "endless" } });
    expect(sandbox.won({ type: "goal-reached", who: 0 })).toBe(false);
  });
});
