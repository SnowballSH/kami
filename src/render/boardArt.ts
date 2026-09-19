import rough from "roughjs";
import type { Drawable, Options } from "roughjs/bin/core";
import type { RoughGenerator } from "roughjs/bin/generator";
import type { BoardDefinition, SolidDef } from "../board/types";
import { clamp, expandRect, type Rect, rectCenter } from "../core/geometry";
import { BOARD_COLORS } from "./palette";

export interface ArtPiece {
  readonly bounds: Rect;
  readonly drawable: Drawable;
}

export interface BoardArt {
  readonly scenery: readonly ArtPiece[];
  readonly door: ArtPiece | null;
}

const ART_MARGIN = 12;
export const MAX_BOW_PX = 3;

const ART_SEED = 1865;
const SEED_OFFSETS = { noInk: 500, goal: 900, door: 950 } as const;
const HATCH_ANGLES = [-41, -58, -33] as const;
const ROUGH_BOW_DIVISOR = 100;
const EXACT_HATCH_ROUGHNESS = 0.9;

const MARKER_LINE: Options = {
  stroke: BOARD_COLORS.marker,
  strokeWidth: 3,
  roughness: EXACT_HATCH_ROUGHNESS,
};

const HATCHED: Options = {
  ...MARKER_LINE,
  fill: BOARD_COLORS.hatch,
  fillStyle: "hachure",
  fillWeight: 1,
  hachureGap: 18,
};

const GLASS: Options = {
  stroke: BOARD_COLORS.glassEdge,
  strokeWidth: 2.5,
  roughness: 0.8,
  fill: BOARD_COLORS.glassFill,
  fillStyle: "solid",
};

const NO_INK: Options = {
  stroke: "none",
  fill: BOARD_COLORS.noInk,
  fillStyle: "hachure",
  fillWeight: 1.4,
  hachureGap: 14,
  hachureAngle: 45,
  roughness: EXACT_HATCH_ROUGHNESS,
};

const RABBIT_HOLE: Options = {
  stroke: BOARD_COLORS.marker,
  strokeWidth: 2.5,
  roughness: 1.6,
  fill: BOARD_COLORS.marker,
  fillStyle: "zigzag",
  fillWeight: 2.2,
  hachureGap: 5,
  hachureAngle: -20,
};

const DOOR: Options = {
  ...MARKER_LINE,
  strokeWidth: 2,
  roughness: 0.6,
  fill: BOARD_COLORS.board,
  fillStyle: "solid",
};

export const bowingFor = (rect: Rect): number =>
  clamp((MAX_BOW_PX * ROUGH_BOW_DIVISOR) / Math.max(rect.width, rect.height, 1), 0, 1);

const piece = (rect: Rect, drawable: Drawable): ArtPiece => ({
  bounds: expandRect(rect, ART_MARGIN),
  drawable,
});

const rectangle = (generator: RoughGenerator, rect: Rect, options: Options): ArtPiece =>
  piece(
    rect,
    generator.rectangle(rect.x, rect.y, rect.width, rect.height, {
      ...options,
      bowing: bowingFor(rect),
    }),
  );

const solidArt = (generator: RoughGenerator, solid: SolidDef, index: number): ArtPiece => {
  const seed = ART_SEED + index;
  if (solid.material === "glass") return rectangle(generator, solid.rect, { ...GLASS, seed });
  const hachureAngle = HATCH_ANGLES[index % HATCH_ANGLES.length] ?? HATCH_ANGLES[0];
  return rectangle(generator, solid.rect, { ...HATCHED, hachureAngle, seed });
};

const rabbitHoleArt = (generator: RoughGenerator, goal: Rect): ArtPiece => {
  const center = rectCenter(goal);
  const seed = ART_SEED + SEED_OFFSETS.goal;
  return piece(
    goal,
    generator.ellipse(center.x, center.y, goal.width, goal.height, { ...RABBIT_HOLE, seed }),
  );
};

export const composeBoardArt = (board: BoardDefinition): BoardArt => {
  const generator = rough.generator();
  const noInk = board.noInkZones.map((zone, index) =>
    rectangle(generator, zone, { ...NO_INK, seed: ART_SEED + SEED_OFFSETS.noInk + index }),
  );
  const solids = board.solids.map((solid, index) => solidArt(generator, solid, index));
  const goal = board.goal === undefined ? [] : [rabbitHoleArt(generator, board.goal)];
  return {
    scenery: [...noInk, ...solids, ...goal],
    door:
      board.door === undefined
        ? null
        : rectangle(generator, board.door, { ...DOOR, seed: ART_SEED + SEED_OFFSETS.door }),
  };
};
