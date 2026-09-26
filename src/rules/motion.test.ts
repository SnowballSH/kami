import { describe, expect, it } from "vitest";
import { editOf, isStill, motionOf, speaksOf } from "./motion";
import type { BodyLaw, Target } from "./types";
import { STILL } from "./types";

const named = (name: string): Target => ({ kind: "named", name });
const ALL: Target = { kind: "all" };
const law = (of: Target, edit: BodyLaw["edit"]): BodyLaw => ({ of, edit });

describe("speaksOf", () => {
  it("matches a drawing by any word of its name, singular or plural", () => {
    expect(speaksOf(named("wheel"), "a spinning wheel")).toBe(true);
    expect(speaksOf(named("wheels"), "the wheel")).toBe(true);
    expect(speaksOf(named("wheel"), "two wheels")).toBe(true);
    expect(speaksOf(named("box"), "boxes")).toBe(true);
    expect(speaksOf(named("wheel"), "a rock")).toBe(false);
    expect(speaksOf(named("wheel"), "")).toBe(false);
  });

  it("ignores the case of a target the model named", () => {
    expect(speaksOf(named("Wheel"), "a spinning wheel")).toBe(true);
    expect(speaksOf(named("WHEELS"), "The Wheel")).toBe(true);
  });

  it("matches a phrase only when every one of its words is in the name", () => {
    expect(speaksOf(named("black hole"), "a black hole")).toBe(true);
    expect(speaksOf(named("lily pads"), "a lily pad")).toBe(true);
    expect(speaksOf(named("lily pads"), "a lily")).toBe(false);
    expect(speaksOf(named("black hole"), "a hole")).toBe(false);
  });

  it("never speaks of anything through an empty name", () => {
    expect(speaksOf(named(""), "a rock")).toBe(false);
    expect(speaksOf(named("  "), "a rock")).toBe(false);
  });

  it("knows the plurals that add -es or turn -y into -ies", () => {
    expect(speaksOf(named("buses"), "a bus")).toBe(true);
    expect(speaksOf(named("bus"), "two buses")).toBe(true);
    expect(speaksOf(named("glasses"), "a glass")).toBe(true);
    expect(speaksOf(named("houses"), "a house")).toBe(true);
    expect(speaksOf(named("puppies"), "a puppy")).toBe(true);
    expect(speaksOf(named("gas"), "a bus")).toBe(false);
    expect(speaksOf(named("bus"), "a bush")).toBe(false);
  });

  it("speaks of everything, named or not, with `all`", () => {
    expect(speaksOf(ALL, "")).toBe(true);
    expect(speaksOf(ALL, "a rock")).toBe(true);
  });
});

describe("motionOf", () => {
  it("is still under no law and no name", () => {
    expect(motionOf({}, [], "")).toEqual(STILL);
    expect(isStill(motionOf({}, [], ""))).toBe(true);
  });

  it("starts from what the name asked for, then applies each law that speaks of it, later winning", () => {
    const laws = [
      law(ALL, { mass: 2 }),
      law(named("wheel"), { spin: 1 }),
      law(named("rock"), { spin: 3 }),
      law(named("wheel"), { spin: -1 }),
    ];
    expect(motionOf({ spin: 0.5, grip: 2 }, laws, "the big wheel")).toEqual({
      ...STILL,
      spin: -1,
      mass: 2,
      grip: 2,
    });
    expect(motionOf({}, laws, "a rock")).toEqual({ ...STILL, spin: 3, mass: 2 });
    expect(motionOf({}, laws, "a cloud")).toEqual({ ...STILL, mass: 2 });
  });

  it("lets a later law on everything override a name's own motion", () => {
    expect(motionOf({ spin: 1 }, [law(ALL, { spin: 0 })], "wheel").spin).toBe(0);
  });
});

describe("editOf", () => {
  it("turns a body effect into the one-dial edit it denotes", () => {
    expect(editOf({ governs: "spin", of: ALL, value: 2 })).toEqual({ spin: 2 });
    expect(editOf({ governs: "thrust", of: ALL, x: 1, y: -1 })).toEqual({
      thrust: { x: 1, y: -1 },
    });
  });
});
