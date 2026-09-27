import { describe, expect, it } from "vitest";
import { validEffect, validPhysics } from "./effectDomains";
import { GOVERNS } from "./subjects";
import { EARTH } from "./types";

describe("effect domains", () => {
  it("knows every dial of the world", () => {
    const { bodies: _bodies, ...dials } = EARTH;
    expect(new Set(GOVERNS)).toEqual(new Set(Object.keys(dials)));
  });

  it("accepts Earth and refuses a dial or a body law out of its domain", () => {
    expect(validPhysics(EARTH)).toBe(true);
    expect(validPhysics({ ...EARTH, gravity: { x: 0, y: 99 } })).toBe(false);
    expect(validPhysics({ ...EARTH, clones: 1.5 })).toBe(false);
    const law = { of: { kind: "all" } as const, edit: { thrust: { x: 0, y: -1 }, size: 2 } };
    expect(validPhysics({ ...EARTH, bodies: [law] })).toBe(true);
    expect(validPhysics({ ...EARTH, bodies: [{ ...law, edit: { size: 9 } }] })).toBe(false);
    expect(validPhysics({ ...EARTH, bodies: [{ ...law, edit: { thrust: { x: 9, y: 0 } } }] })).toBe(
      false,
    );
    expect(
      validPhysics({ ...EARTH, bodies: [{ of: { kind: "named", name: " " }, edit: {} }] }),
    ).toBe(false);
  });

  it("checks both parts of a field and the target of a body effect", () => {
    expect(validEffect({ governs: "wind", x: 1, y: 0 })).toBe(true);
    expect(validEffect({ governs: "wind", x: 1, y: Number.NaN })).toBe(false);
    expect(validEffect({ governs: "spin", of: { kind: "named", name: "wheel" }, value: 1 })).toBe(
      true,
    );
    expect(validEffect({ governs: "spin", of: { kind: "named", name: "" }, value: 1 })).toBe(false);
  });
});
