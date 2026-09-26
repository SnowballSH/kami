import { describe, expect, it } from "vitest";
import { EFFECT_DOMAINS } from "../src/rules/effectDomains";
import { ruleEffectSchema, rulingSchema } from "./schemas";

describe("persisted numeric domains", () => {
  it("accepts every inclusive boundary and rejects values outside it", () => {
    for (const [governs, { min, max }] of Object.entries(EFFECT_DOMAINS)) {
      const of = { kind: "all" };
      const effect = (value: number) => {
        switch (governs) {
          case "gravity":
          case "wind":
            return { governs, x: value, y: value };
          case "thrust":
            return { governs, of, x: value, y: value };
          case "spin":
          case "mass":
          case "bounce":
          case "grip":
          case "pace":
          case "wings":
          case "size":
          case "heed":
          case "glow":
            return { governs, of, value };
          default:
            return { governs, value };
        }
      };
      for (const value of [min, max]) {
        expect(ruleEffectSchema.safeParse(effect(value)).success, `${governs}=${value}`).toBe(true);
      }
      for (const value of [min - 1, max + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(ruleEffectSchema.safeParse(effect(value)).success, `${governs}=${value}`).toBe(
          false,
        );
      }
    }
  });

  it.each([-1, 0.5, 8.5, 1e9])("rejects clone count %s", (value) => {
    expect(ruleEffectSchema.safeParse({ governs: "clones", value }).success).toBe(false);
  });

  it("round-trips a glowing creature's own motion and a glow law", () => {
    const ruling = {
      name: "a firefly",
      nature: "flier",
      strength: 1,
      tags: [],
      line: "",
      motion: { glow: 1 },
    };
    expect(rulingSchema.parse(JSON.parse(JSON.stringify(ruling)))).toEqual(ruling);
    const law = { governs: "glow", of: { kind: "named", name: "dog" }, value: 0 };
    expect(ruleEffectSchema.parse(JSON.parse(JSON.stringify(law)))).toEqual(law);
    const older = { ...ruling, motion: { spin: 1 } };
    expect(rulingSchema.parse(older)).toEqual(older);
  });

  it("rejects zero size and keeps the strength contract", () => {
    expect(ruleEffectSchema.safeParse({ governs: "aliceSize", value: 0 }).success).toBe(false);
    const ruling = { name: "rock", nature: "heavy", tags: [], line: "" };
    for (const strength of [0.5, 1, 2]) {
      expect(rulingSchema.safeParse({ ...ruling, strength }).success).toBe(true);
    }
    for (const strength of [0, 2.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rulingSchema.safeParse({ ...ruling, strength }).success).toBe(false);
    }
  });
});
