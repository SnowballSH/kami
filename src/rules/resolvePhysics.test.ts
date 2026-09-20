import { describe, expect, it } from "vitest";
import type { NoteId } from "../notes/types";
import { resolvePhysics } from "./index";
import { EARTH, type Rule, type RuleEffect, type RuleId } from "./types";

const rule = (id: string, createdAt: number, effect: RuleEffect): Rule => ({
  id: id as RuleId,
  noteId: `note-${id}` as NoteId,
  sourceText: id,
  position: { x: 0, y: 0 },
  createdAt,
  effect,
  explanation: id,
});

const MOON = rule("moon", 100, { governs: "gravity", x: 0, y: 0.165 });
const MARS = rule("mars", 200, { governs: "gravity", x: 0, y: 0.38 });
const SLOW = rule("slow", 150, { governs: "timeScale", value: 0.5 });
const GUST = rule("gust", 50, { governs: "wind", x: 0.3, y: 0 });
const WHEEL = { kind: "named", name: "wheel" } as const;
const TURNS = rule("turns", 300, { governs: "spin", of: WHEEL, value: 1 });
const TURNS_BACK = rule("turns-back", 400, { governs: "spin", of: WHEEL, value: -1 });
const ALL_HEAVY = rule("all-heavy", 350, { governs: "mass", of: { kind: "all" }, value: 2 });

describe("resolvePhysics", () => {
  it("is Earth when nothing has been written", () => {
    expect(resolvePhysics([])).toEqual(EARTH);
  });

  it("folds over the world it is given, when a room lays down its own", () => {
    const dark = { ...EARTH, daylight: 0, inkEater: 1 };
    expect(resolvePhysics([], dark)).toEqual(dark);
    expect(resolvePhysics([MOON], dark)).toEqual({ ...dark, gravity: { x: 0, y: 0.165 } });
    expect(resolvePhysics([rule("sealed", 1, { governs: "inkEater", value: 0 })], dark)).toEqual({
      ...dark,
      inkEater: 0,
    });
  });

  it("lets the newest rule per setting win, whatever order they arrive in", () => {
    const expected = {
      ...EARTH,
      gravity: { x: 0, y: 0.38 },
      timeScale: 0.5,
      wind: { x: 0.3, y: 0 },
    };
    expect(resolvePhysics([MOON, MARS, SLOW, GUST])).toEqual(expected);
    expect(resolvePhysics([GUST, SLOW, MARS, MOON])).toEqual(expected);
  });

  it("restores the rule before when the newest is erased", () => {
    expect(resolvePhysics([MOON, MARS].filter((standing) => standing !== MARS)).gravity).toEqual({
      x: 0,
      y: 0.165,
    });
  });

  it("breaks a tie in time the same way in any order", () => {
    const twin = rule("venus", MARS.createdAt, { governs: "gravity", x: 0, y: 0.9 });
    expect(resolvePhysics([MARS, twin])).toEqual(resolvePhysics([twin, MARS]));
  });

  it("leaves EARTH and its inputs untouched", () => {
    const rules = [MARS, MOON];
    resolvePhysics(rules);
    expect(rules).toEqual([MARS, MOON]);
    expect(EARTH.gravity).toEqual({ x: 0, y: 1 });
  });

  it("keeps every law about drawings, oldest first, for the bodies to read at tick time", () => {
    expect(resolvePhysics([TURNS_BACK, ALL_HEAVY, TURNS]).bodies).toEqual([
      { of: WHEEL, edit: { spin: 1 } },
      { of: { kind: "all" }, edit: { mass: 2 } },
      { of: WHEEL, edit: { spin: -1 } },
    ]);
  });

  it("forgets a drawing law when its note is erased, leaving the world dials alone", () => {
    const physics = resolvePhysics(
      [MOON, TURNS, TURNS_BACK].filter((standing) => standing !== TURNS_BACK),
    );
    expect(physics.bodies).toEqual([{ of: WHEEL, edit: { spin: 1 } }]);
    expect(physics.gravity).toEqual({ x: 0, y: 0.165 });
  });

  it("ignores unsafe historic effects without hiding a valid older law or its repeal", () => {
    const standing = rule("clones", 100, { governs: "clones", value: 2 });
    for (const effect of [
      { governs: "clones", value: -1 },
      { governs: "clones", value: 0.5 },
      { governs: "clones", value: 1000 },
      { governs: "aliceSize", value: 0 },
      { governs: "inkEater", value: -1 },
    ] satisfies RuleEffect[]) {
      const broken = rule("historic", 200, effect);
      expect(resolvePhysics([standing, broken])).toEqual({ ...EARTH, clones: 2 });
      expect(resolvePhysics([broken])).toEqual(EARTH);
    }
  });
});
