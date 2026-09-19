import type { Drawable } from "roughjs/bin/core";
import { describe, expect, it } from "vitest";
import { LEVELS } from "../game/levels";
import { riverbank } from "../game/levels/riverbank";
import type { LevelDefinition } from "../game/types";
import { composeLevelArt } from "./levelArt";

const isHatched = (drawable: Drawable): boolean =>
  drawable.sets.some((set) => set.type === "fillSketch");

const withNoInkZone: LevelDefinition = {
  ...riverbank,
  noInkZones: [{ x: 400, y: 300, width: 120, height: 80 }],
};

describe("composeLevelArt", () => {
  it.each(LEVELS)("draws $id the same way every time", (level) => {
    expect(composeLevelArt(level)).toEqual(composeLevelArt(level));
  });

  it.each(LEVELS)("hatches the paper solids of $id and leaves glass clear", (level) => {
    const paperSolids = level.solids.filter((solid) => solid.material === "paper");
    expect(composeLevelArt(level).filter(isHatched)).toHaveLength(paperSolids.length);
  });

  it("hatches no-ink zones in red", () => {
    const hatched = composeLevelArt(withNoInkZone).filter(isHatched);
    expect(hatched.some((drawable) => drawable.options.fill === "#be2a2a")).toBe(true);
  });
});
