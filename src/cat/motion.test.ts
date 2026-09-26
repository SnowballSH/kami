import { describe, expect, it } from "vitest";
import { ruleOn as rule } from "./ruling";

const ruleOn = (utterance: string) => rule(utterance, { allowed: "all", drawingIsDot: false });

describe("motion in a name", () => {
  it("makes a spinning wheel spin once a second, faster when very", () => {
    expect(ruleOn("a spinning wheel").motion).toEqual({ spin: 1 });
    expect(ruleOn("a very spinning wheel").motion?.spin).toBeGreaterThan(1);
    expect(ruleOn("a wheel spinning counterclockwise").motion).toEqual({ spin: -1 });
  });

  it("gives a rocket-powered cart a push to the right, or upward when it says so", () => {
    expect(ruleOn("a powered cart").motion).toEqual({ thrust: { x: 0.5, y: 0 } });
    expect(ruleOn("a rocket boosted up").motion).toEqual({ thrust: { x: 0, y: -0.5 } });
  });

  it("keeps a creature's nature and adds the motion beside it", () => {
    const ruling = ruleOn("a spinning cat");
    expect(ruling.nature).toBe("walker");
    expect(ruling.motion).toEqual({ spin: 1 });
  });

  it.each([
    ["a glowing rabbit", "hopper"],
    ["a shining dog", "walker"],
    ["a luminous bird", "flier"],
    ["a glowing flying rock", "flier"],
    ["a walking lamp", "walker"],
    ["a firefly", "flier"],
    ["a lightning bug", "flier"],
    ["a glowworm", "walker"],
  ] as const)("keeps %j a %s that carries its own light", (name, nature) => {
    const ruling = ruleOn(name);
    expect(ruling.nature).toBe(nature);
    expect(ruling.motion?.glow).toBe(1);
  });

  it.each(["a glowing lantern", "a lamp", "a glowing rock", "a lit candle"])(
    "leaves %j a lantern, light by nature rather than by power",
    (name) => {
      const ruling = ruleOn(name);
      expect(ruling.nature).toBe("lantern");
      expect(ruling.motion).toBeUndefined();
    },
  );

  it("leaves motion off names that ask for none", () => {
    expect(ruleOn("a mushroom").motion).toBeUndefined();
    expect(ruleOn("a rock").motion).toBeUndefined();
  });
});
