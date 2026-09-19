import rough from "roughjs";
import type { Drawable, Options } from "roughjs/bin/core";
import type { RoughGenerator } from "roughjs/bin/generator";
import type { Rect } from "../core/geometry";
import type { LevelDefinition, SolidDef } from "../game/types";
import { PAGE_COLORS } from "./palette";

const ART_SEED = 1865;
const NO_INK_SEED_OFFSET = 500;
const HATCH_ANGLES = [-41, -58, -33] as const;

const WASH: Options = {
  stroke: "none",
  fill: PAGE_COLORS.solidWash,
  fillStyle: "solid",
  roughness: 0.6,
};

const ENGRAVING: Options = {
  stroke: PAGE_COLORS.printInk,
  strokeWidth: 2.2,
  roughness: 1.2,
  bowing: 1,
  fill: PAGE_COLORS.printInk,
  fillStyle: "hachure",
  fillWeight: 0.8,
  hachureGap: 7,
};

const GLASS: Options = {
  stroke: PAGE_COLORS.glassEdge,
  strokeWidth: 1.6,
  roughness: 0.7,
  fill: PAGE_COLORS.glassFill,
  fillStyle: "solid",
};

const RED_PAINT: Options = {
  stroke: "none",
  fill: PAGE_COLORS.noInkRed,
  fillStyle: "hachure",
  fillWeight: 1.4,
  hachureGap: 9,
  hachureAngle: 45,
  roughness: 1.4,
};

const RED_WASH: Options = { ...WASH, fill: PAGE_COLORS.noInkWash };

const rectangle = (generator: RoughGenerator, rect: Rect, options: Options): Drawable =>
  generator.rectangle(rect.x, rect.y, rect.width, rect.height, options);

const solidArt = (generator: RoughGenerator, solid: SolidDef, index: number): Drawable[] => {
  const seed = ART_SEED + index;
  if (solid.material === "glass") return [rectangle(generator, solid.rect, { ...GLASS, seed })];
  const hachureAngle = HATCH_ANGLES[index % HATCH_ANGLES.length] ?? HATCH_ANGLES[0];
  return [
    rectangle(generator, solid.rect, { ...WASH, seed }),
    rectangle(generator, solid.rect, { ...ENGRAVING, hachureAngle, seed }),
  ];
};

const noInkArt = (generator: RoughGenerator, zone: Rect, index: number): Drawable[] => {
  const seed = ART_SEED + NO_INK_SEED_OFFSET + index;
  return [
    rectangle(generator, zone, { ...RED_WASH, seed }),
    rectangle(generator, zone, { ...RED_PAINT, seed }),
  ];
};

export const composeLevelArt = (level: LevelDefinition): readonly Drawable[] => {
  const generator = rough.generator();
  return [
    ...level.noInkZones.flatMap((zone, index) => noInkArt(generator, zone, index)),
    ...level.solids.flatMap((solid, index) => solidArt(generator, solid, index)),
  ];
};
