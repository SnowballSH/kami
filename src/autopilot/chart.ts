import type { Nature } from "../cat/types";
import {
  boundsOf,
  poseToWorld,
  type Rect,
  rectsOverlap,
  remainingColumns,
  type Vec,
} from "../core/geometry";
import { INK_THICKNESS } from "../core/world";
import { bearingStrokes } from "../ink/bearing";
import type { DrawingId } from "../ink/types";
import type { Scene, SceneInk } from "./types";

export const CELL_PX = 8;

export const CellFlag = {
  solid: 1,
  fixture: 2,
  climbable: 4,
  bouncy: 8,
  edible: 16,
  door: 32,
  hazard: 64,
  goal: 128,
} as const;

const INK_RADIUS = INK_THICKNESS / 2;
const STAMP_SPACING = CELL_PX / 2;
/** Cells of empty margin around everything drawn, so she can stand and fall beside it. */
const MARGIN_CELLS = 12;
/** On an endless page she reads only this much paper around herself, in pixels each way. */
export const WINDOW_PX = { x: 1600, y: 1000 } as const;
export const MAX_CHART_CELLS = 1_000_000;
const MAX_AXIS_CELLS = 4096;
const MAX_GEOMETRY_ITEMS = 50_000;
const STAMP_BUDGET = 2_000_000;

export interface CellRange {
  readonly c0: number;
  readonly c1: number;
  readonly r0: number;
  readonly r1: number;
}

/** Grid cells [c0, c1) × [r0, r1) touched by a world rect. */
export const cellsOf = (rect: Rect): CellRange => ({
  c0: Math.floor(rect.x / CELL_PX),
  c1: Math.ceil((rect.x + rect.width) / CELL_PX),
  r0: Math.floor(rect.y / CELL_PX),
  r1: Math.ceil((rect.y + rect.height) / CELL_PX),
});

const union = (a: CellRange, b: CellRange): CellRange => ({
  c0: Math.min(a.c0, b.c0),
  c1: Math.max(a.c1, b.c1),
  r0: Math.min(a.r0, b.r0),
  r1: Math.max(a.r1, b.r1),
});

const grow = (range: CellRange, by: number): CellRange => ({
  c0: range.c0 - by,
  c1: range.c1 + by,
  r0: range.r0 - by,
  r1: range.r1 + by,
});

/** How each nature reads underfoot; mirrors what the simulation lets Alice stand on and pass through. Creatures are charted where they stand right now; the plan is redrawn as they move. */
const flagsFor = (nature: Nature): number => {
  switch (nature) {
    case "climbable":
      return CellFlag.climbable;
    case "goal":
      return CellFlag.goal;
    case "spawn":
    case "portal":
      return 0;
    case "bouncy":
      return CellFlag.solid | CellFlag.bouncy;
    case "grow":
    case "shrink":
      return CellFlag.solid | CellFlag.edible;
    case "hazard":
      return CellFlag.solid | CellFlag.hazard;
    case "solid":
    case "attractor":
      return CellFlag.solid | CellFlag.fixture;
    default:
      return CellFlag.solid;
  }
};

const worldPoints = (ink: SceneInk): Vec[] =>
  bearingStrokes(ink.drawing.strokes).flatMap((stroke) =>
    stroke.map((point) => poseToWorld(point, ink.pose)),
  );

export const boundsOfInk = (ink: SceneInk): Rect => boundsOf(worldPoints(ink));

const aliceRect = (scene: Scene): Rect => ({
  x: scene.alice.center.x - scene.alice.width / 2,
  y: scene.alice.center.y - scene.alice.height / 2,
  width: scene.alice.width,
  height: scene.alice.height,
});

const CREATURES: ReadonlySet<Nature> = new Set<Nature>(["walker", "hopper", "flier", "vehicle"]);
const CRAMP_INSET = 2;

/**
 * A creature pressed against Alice (on her head, or half through her) would wall off the very
 * cell she stands in; she plans as if it were not there and lets the next replan catch up.
 */
const cramps = (ink: SceneInk, alice: Rect): boolean =>
  CREATURES.has(ink.nature) &&
  rectsOverlap(boundsOf(worldPoints(ink)), {
    x: alice.x + CRAMP_INSET,
    y: alice.y + CRAMP_INSET,
    width: alice.width - 2 * CRAMP_INSET,
    height: alice.height - 2 * CRAMP_INSET,
  });

const windowAround = (alice: Rect): CellRange =>
  cellsOf({
    x: alice.x + alice.width / 2 - WINDOW_PX.x,
    y: alice.y + alice.height / 2 - WINDOW_PX.y,
    width: 2 * WINDOW_PX.x,
    height: 2 * WINDOW_PX.y,
  });

const extentOf = (scene: Scene): CellRange => {
  const { board } = scene;
  if (board.page === "endless") return windowAround(aliceRect(scene));
  const rects: Rect[] = [
    aliceRect(scene),
    ...board.solids.map((solid) => solid.rect),
    ...(board.door === undefined ? [] : [board.door]),
    ...(board.goal === undefined ? [] : [board.goal]),
    ...(board.key === undefined ? [] : [{ ...board.key, width: 0, height: 0 }]),
    ...scene.inks.map((ink) => boundsOf(worldPoints(ink))),
  ];
  const [first, ...rest] = rects.map(cellsOf);
  if (first === undefined) throw new Error("a scene always has Alice in it");
  const extent = rest.reduce(union, first);
  const killRow = Math.ceil(scene.board.killY / CELL_PX);
  return grow({ ...extent, r1: Math.min(extent.r1, killRow) }, MARGIN_CELLS);
};

const boundedGeometry = (scene: Scene): boolean => {
  let remaining =
    MAX_GEOMETRY_ITEMS - scene.board.solids.length - scene.bites.length - scene.inks.length;
  if (remaining < 0) return false;
  for (const ink of scene.inks) {
    remaining -= ink.drawing.strokes.length;
    if (remaining < 0) return false;
    for (const stroke of ink.drawing.strokes) {
      remaining -= stroke.length;
      if (remaining < 0) return false;
    }
  }
  return true;
};

const rectOf = ({ c0, c1, r0, r1 }: CellRange): Rect => ({
  x: c0 * CELL_PX,
  y: r0 * CELL_PX,
  width: (c1 - c0) * CELL_PX,
  height: (r1 - r0) * CELL_PX,
});

const boundedRange = ({ c0, c1, r0, r1 }: CellRange): boolean => {
  const cols = c1 - c0;
  const rows = r1 - r0;
  return (
    [c0, c1, r0, r1].every(Number.isSafeInteger) &&
    cols > 0 &&
    rows > 0 &&
    cols <= MAX_AXIS_CELLS &&
    rows <= MAX_AXIS_CELLS &&
    cols * rows <= MAX_CHART_CELLS
  );
};

/** The board rasterised the way Alice's feet read it: what is solid, what holds, what springs. */
export class Chart {
  private readonly cells: Uint8Array;
  private readonly bouncyStrength: Float32Array;
  private readonly edibleOwner = new Map<number, DrawingId>();
  private readonly stride: number;
  private stampRemaining = STAMP_BUDGET;

  /** When she can fly, every cell of air holds her the way a ladder would. */
  private constructor(
    readonly range: CellRange,
    airborne: boolean,
  ) {
    this.stride = range.c1 - range.c0;
    const size = this.stride * (range.r1 - range.r0);
    this.cells = new Uint8Array(size);
    if (airborne) this.cells.fill(CellFlag.climbable);
    this.bouncyStrength = new Float32Array(size);
  }

  static of(scene: Scene): Chart | null {
    if (!boundedGeometry(scene)) return null;
    const range = extentOf(scene);
    if (!boundedRange(range)) return null;
    const chart = new Chart(range, scene.canFly);
    const paper = rectOf(range);
    for (const solid of scene.board.solids) {
      if (!rectsOverlap(solid.rect, paper)) continue;
      for (const piece of remainingColumns(solid.rect, scene.bites)) {
        if (!chart.stampRect(piece, CellFlag.solid | CellFlag.fixture)) return null;
      }
    }
    if (scene.board.door !== undefined && !scene.doorOpen) {
      if (!chart.stampRect(scene.board.door, CellFlag.solid | CellFlag.fixture | CellFlag.door))
        return null;
    }
    if (scene.board.goal !== undefined && !chart.stampRect(scene.board.goal, CellFlag.goal))
      return null;
    const alice = aliceRect(scene);
    for (const ink of scene.inks) {
      if (cramps(ink, alice) || !rectsOverlap(boundsOfInk(ink), paper)) continue;
      if (!chart.stampInk(ink, flagsFor(ink.nature))) return null;
    }
    return chart;
  }

  contains(c: number, r: number): boolean {
    const { c0, c1, r0, r1 } = this.range;
    return c >= c0 && c < c1 && r >= r0 && r < r1;
  }

  at(c: number, r: number): number {
    return this.contains(c, r) ? (this.cells[this.index(c, r)] ?? 0) : 0;
  }

  has(c: number, r: number, flag: number): boolean {
    return (this.at(c, r) & flag) !== 0;
  }

  anyIn(range: CellRange, flag: number): boolean {
    for (let r = range.r0; r < range.r1; r++) {
      for (let c = range.c0; c < range.c1; c++) if (this.has(c, r, flag)) return true;
    }
    return false;
  }

  bounceStrengthUnder(c0: number, c1: number, r: number): number {
    let best = 0;
    for (let c = c0; c < c1; c++) {
      if (this.contains(c, r)) {
        best = Math.max(best, this.bouncyStrength[this.index(c, r)] ?? 0);
      }
    }
    return best;
  }

  edibleIn(range: CellRange): DrawingId | null {
    for (let r = range.r0; r < range.r1; r++) {
      for (let c = range.c0; c < range.c1; c++) {
        if (!this.contains(c, r)) continue;
        const owner = this.edibleOwner.get(this.index(c, r));
        if (owner !== undefined) return owner;
      }
    }
    return null;
  }

  private index(c: number, r: number): number {
    return (r - this.range.r0) * this.stride + (c - this.range.c0);
  }

  private mark(c: number, r: number, flags: number, owner?: DrawingId, strength = 0): void {
    if (!this.contains(c, r)) return;
    const index = this.index(c, r);
    this.cells[index] = (this.cells[index] ?? 0) | flags;
    if (flags & CellFlag.bouncy) {
      this.bouncyStrength[index] = Math.max(this.bouncyStrength[index] ?? 0, strength);
    }
    if (flags & CellFlag.edible && owner !== undefined) this.edibleOwner.set(index, owner);
  }

  private spend(work: number): boolean {
    if (!Number.isSafeInteger(work) || work < 0 || work > this.stampRemaining) return false;
    this.stampRemaining -= work;
    return true;
  }

  private spendRange({ c0, c1, r0, r1 }: CellRange): boolean {
    return (
      [c0, c1, r0, r1].every(Number.isSafeInteger) &&
      this.spend(Math.max(0, r1 - r0) * (1 + Math.max(0, c1 - c0)))
    );
  }

  private stampRect(rect: Rect, flags: number): boolean {
    const { c0, c1, r0, r1 } = cellsOf(rect);
    if (!this.spendRange({ c0, c1, r0, r1 })) return false;
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) this.mark(c, r, flags);
    }
    return true;
  }

  private stampInk(ink: SceneInk, flags: number): boolean {
    for (const stroke of bearingStrokes(ink.drawing.strokes)) {
      let previous: Vec | null = null;
      for (const point of stroke) {
        const here = poseToWorld(point, ink.pose);
        const stamped =
          previous === null
            ? this.stampDot(ink, here, flags)
            : this.stampSegment(ink, previous, here, flags);
        if (!stamped) return false;
        previous = here;
      }
    }
    return true;
  }

  private stampSegment(ink: SceneInk, from: Vec, to: Vec, flags: number): boolean {
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / STAMP_SPACING));
    if (!this.spend(steps)) return false;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (
        !this.stampDot(
          ink,
          { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
          flags,
        )
      )
        return false;
    }
    return true;
  }

  private stampDot(ink: SceneInk, at: Vec, flags: number): boolean {
    const { c0, c1, r0, r1 } = cellsOf({
      x: at.x - INK_RADIUS,
      y: at.y - INK_RADIUS,
      width: INK_THICKNESS,
      height: INK_THICKNESS,
    });
    if (!this.spendRange({ c0, c1, r0, r1 })) return false;
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) this.mark(c, r, flags, ink.drawing.id, ink.strength);
    }
    return true;
  }
}
