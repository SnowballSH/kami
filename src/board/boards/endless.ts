import type { Rect } from "../../core/geometry";
import type { BoardDefinition, SolidDef } from "../types";

/** The floor of the page: wide enough that a demo never walks off it. Its top is y = 0. */
export const ENDLESS_GROUND = { x: -6000, y: 0, width: 12_000, height: 36 } as const;

/** Nothing stands this close to the spawn, so the first drawing has room. */
export const ENDLESS_CLEARING = 500;

/** A block standing on the floor: `left` to `left + width`, its top `height` above the ground. */
const rising = (left: number, width: number, height: number): Rect => ({
  x: left,
  y: ENDLESS_GROUND.y - height,
  width,
  height,
});

/** A slab in the air, its top `height` above the ground, holding nothing up and held up by nothing. */
const shelf = (left: number, width: number, height: number): Rect => ({
  x: left,
  y: ENDLESS_GROUND.y - height,
  width,
  height: 28,
});

/**
 * Things to draw against, rising with distance from the spawn. To the right: a step she can jump,
 * two plateaus with a gap to bridge, three bars to climb or span, and a shelf in the air. To the
 * left: a staircase of ledges, a tower, and columns of three heights.
 */
export const ENDLESS_HIGH_GROUNDS: readonly Rect[] = [
  rising(600, 300, 60),
  rising(1100, 600, 240),
  rising(2100, 600, 240),
  rising(3100, 50, 420),
  rising(3400, 50, 420),
  rising(3700, 50, 420),
  shelf(4200, 500, 330),
  rising(-900, 300, 80),
  rising(-1300, 400, 160),
  rising(-1800, 500, 260),
  rising(-2400, 100, 520),
  rising(-2900, 60, 200),
  rising(-3150, 60, 320),
  rising(-3400, 60, 440),
];

const marker = (rect: Rect): SolidDef => ({ rect, material: "marker" });

/** A page with no edges whose only paper is `solids`: beyond them, nothing until someone draws. */
export const endlessPage = (id: string, solids: readonly Rect[]): BoardDefinition => ({
  id,
  title: id,
  page: "endless",
  spawn: { x: 0, y: ENDLESS_GROUND.y },
  killY: Number.POSITIVE_INFINITY,
  solids: solids.map(marker),
  zones: [],
  noInkZones: [],
});

/** The sandbox's page: a very wide floor with high grounds and bars along it. */
export const endlessBoard = (id: string): BoardDefinition =>
  endlessPage(id, [ENDLESS_GROUND, ...ENDLESS_HIGH_GROUNDS]);

/** A short strip of floor under the spawn: a page whose edge is a few steps away. */
export const ENDLESS_STRIP = { x: -400, y: 0, width: 800, height: 36 } as const;
