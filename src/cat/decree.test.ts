import { describe, expect, it } from "vitest";
import { EARTH_G_MPS2 } from "../core/physics";
import type { DrawingId } from "../ink/types";
import { NO_FACTS, type WorldEdit, type WorldFacts } from "../world/types";
import { decree } from "./decree";
import { NO_SPELL_LINE } from "./spellbook";

const editsOf = (text: string, facts: WorldFacts = NO_FACTS): readonly WorldEdit[] =>
  decree(text, facts).edits;

const FACTS_WITH_INK: WorldFacts = {
  ...NO_FACTS,
  room: { ...NO_FACTS.room, ink: { total: 900, remaining: 120 } },
  drawings: [
    {
      id: "a" as DrawingId,
      name: "a plank",
      nature: "ink",
      strength: 1,
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      isStatic: true,
    },
    {
      id: "b" as DrawingId,
      name: null,
      nature: "ink",
      strength: 1,
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      isStatic: false,
    },
  ],
};

describe("decree", () => {
  it("reads g in metres per second squared", () => {
    const [edit] = editsOf("g = 1 m/s^2");
    expect(edit).toMatchObject({ op: "set_gravity" });
    expect(edit?.op === "set_gravity" ? edit.magnitudeG : null).toBeCloseTo(1 / EARTH_G_MPS2, 5);
    expect(editsOf("g = 4.9 m/s²")[0]).toMatchObject({ op: "set_gravity" });
  });

  it("reads gravity as multiples of Earth when there is no unit", () => {
    expect(editsOf("gravity = 2")).toEqual([{ op: "set_gravity", magnitudeG: 2 }]);
    expect(editsOf("gravity 0.5")).toEqual([{ op: "set_gravity", magnitudeG: 0.5 }]);
  });

  it("knows the moon, no gravity, and which way is down", () => {
    expect(editsOf("moon gravity")).toEqual([{ op: "set_gravity", magnitudeG: 0.165 }]);
    expect(editsOf("no gravity")).toEqual([{ op: "set_gravity", magnitudeG: 0 }]);
    expect(editsOf("zero g")).toEqual([{ op: "set_gravity", magnitudeG: 0 }]);
    expect(editsOf("flip gravity")).toEqual([{ op: "set_gravity", angleDeg: -90 }]);
    expect(editsOf("gravity points left")).toEqual([{ op: "set_gravity", angleDeg: 180 }]);
  });

  it("bends time", () => {
    expect(editsOf("slow motion")).toEqual([{ op: "set_time_scale", factor: 0.4 }]);
    expect(editsOf("time = 3")).toEqual([{ op: "set_time_scale", factor: 3 }]);
    expect(editsOf("2x speed")).toEqual([{ op: "set_time_scale", factor: 2 }]);
    expect(editsOf("freeze time")).toEqual([{ op: "set_time_scale", factor: 0 }]);
  });

  it("raises and calms the wind", () => {
    const [left] = editsOf("wind blowing left 0.8");
    expect(left?.op).toBe("set_wind");
    if (left?.op === "set_wind") {
      expect(left.x).toBeCloseTo(-0.8, 5);
      expect(left.y).toBeCloseTo(0, 5);
    }
    expect(editsOf("no wind")).toEqual([{ op: "set_wind", x: 0, y: 0 }]);
  });

  it("changes the feel of surfaces only when the whole world is meant", () => {
    expect(editsOf("the floor is ice")).toEqual([{ op: "set_friction", factor: 0.05 }]);
    expect(editsOf("ice")).toEqual([]);
    expect(editsOf("everything is bouncy").at(-1)).toEqual({
      op: "set_bounciness",
      restitution: 0.9,
    });
    expect(editsOf("bounciness 0.3")).toEqual([{ op: "set_bounciness", restitution: 0.3 }]);
    expect(editsOf("underwater")).toEqual([{ op: "set_air_drag", factor: 8 }]);
  });

  it("talks about Alice", () => {
    expect(editsOf("alice runs")).toEqual([{ op: "set_walk_speed", factor: 2 }]);
    expect(editsOf("she is slower")).toEqual([{ op: "set_walk_speed", factor: 0.5 }]);
    expect(editsOf("alice is tiny")).toEqual([{ op: "resize_alice", size: "small" }]);
    expect(editsOf("grow alice")).toEqual([{ op: "resize_alice", size: "big" }]);
  });

  it("handles ink and the page", () => {
    expect(editsOf("more ink", FACTS_WITH_INK)).toEqual([{ op: "set_ink", remaining: 900 }]);
    expect(editsOf("infinite ink")).toEqual([
      { op: "set_ink", total: 1_000_000, remaining: 1_000_000 },
    ]);
    expect(editsOf("erase everything", FACTS_WITH_INK)).toEqual([
      { op: "remove_drawing", drawingId: "a" },
      { op: "remove_drawing", drawingId: "b" },
    ]);
    expect(editsOf("everything is floaty", FACTS_WITH_INK)).toEqual([
      { op: "set_nature", drawingId: "a", nature: "floaty" },
      { op: "set_nature", drawingId: "b", nature: "floaty" },
    ]);
  });

  it("chains clauses and resets", () => {
    expect(editsOf("g = 0.5, wind right and slow motion")).toEqual([
      { op: "set_gravity", magnitudeG: 0.5 / EARTH_G_MPS2 },
      { op: "set_wind", x: 0.6, y: 0 },
      { op: "set_time_scale", factor: 0.4 },
    ]);
    expect(editsOf("back to normal")).toEqual([{ op: "reset_physics" }]);
  });

  it("says so when the words mean nothing to it", () => {
    expect(decree("a lovely mushroom", NO_FACTS)).toEqual({ edits: [], line: NO_SPELL_LINE });
    expect(decree("a heavy rock", NO_FACTS).edits).toEqual([]);
    expect(decree("soap", NO_FACTS).edits).toEqual([]);
  });
});
