import type { Nature } from "../cat/types";
import { boundsOf, poseToWorld, type Rect, type Vec } from "../core/geometry";
import { INK_THICKNESS } from "../core/world";
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

/** How each nature reads underfoot; mirrors what the simulation lets Alice stand on and pass through. */
const flagsFor = (nature: Nature): number => {
  switch (nature) {
    case "climbable":
      return CellFlag.climbable;
    case "goal":
      return CellFlag.goal;
    case "spawn":
      return 0;
    case "bouncy":
      return CellFlag.solid | CellFlag.bouncy;
    case "grow":
    case "shrink":
      return CellFlag.solid | CellFlag.edible;
    case "hazard":
      return CellFlag.solid | CellFlag.hazard;
    case "solid":
      return CellFlag.solid | CellFlag.fixture;
    default:
      return CellFlag.solid;
  }
};

const worldPoints = (ink: SceneInk): Vec[] =>
  ink.drawing.strokes.flatMap((stroke) => stroke.map((point) => poseToWorld(point, ink.pose)));

const aliceRect = (scene: Scene): Rect => ({
  x: scene.alice.center.x - scene.alice.width / 2,
  y: scene.alice.center.y - scene.alice.height / 2,
  width: scene.alice.width,
  height: scene.alice.height,
});

const extentOf = (scene: Scene): CellRange => {
  const { board } = scene;
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

/** The board rasterised the way Alice's feet read it: what is solid, what holds, what springs. */
export class Chart {
  private readonly cells: Uint8Array;
  private readonly bouncyStrength: Float32Array;
  private readonly edibleOwner = new Map<number, DrawingId>();
  private readonly stride: number;

  private constructor(readonly range: CellRange) {
    this.stride = range.c1 - range.c0;
    const size = this.stride * (range.r1 - range.r0);
    this.cells = new Uint8Array(size);
    this.bouncyStrength = new Float32Array(size);
  }

  static of(scene: Scene): Chart {
    const chart = new Chart(extentOf(scene));
    for (const solid of scene.board.solids) {
      chart.stampRect(solid.rect, CellFlag.solid | CellFlag.fixture);
    }
    if (scene.board.door !== undefined && !scene.doorOpen) {
      chart.stampRect(scene.board.door, CellFlag.solid | CellFlag.fixture | CellFlag.door);
    }
    if (scene.board.goal !== undefined) chart.stampRect(scene.board.goal, CellFlag.goal);
    for (const ink of scene.inks) chart.stampInk(ink, flagsFor(ink.nature));
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

  private stampRect(rect: Rect, flags: number): void {
    const { c0, c1, r0, r1 } = cellsOf(rect);
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) this.mark(c, r, flags);
    }
  }

  private stampInk(ink: SceneInk, flags: number): void {
    for (const stroke of ink.drawing.strokes) {
      let previous: Vec | null = null;
      for (const point of stroke) {
        const here = poseToWorld(point, ink.pose);
        if (previous === null) this.stampDot(ink, here, flags);
        else this.stampSegment(ink, previous, here, flags);
        previous = here;
      }
    }
  }

  private stampSegment(ink: SceneInk, from: Vec, to: Vec, flags: number): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / STAMP_SPACING));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.stampDot(
        ink,
        { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
        flags,
      );
    }
  }

  private stampDot(ink: SceneInk, at: Vec, flags: number): void {
    const { c0, c1, r0, r1 } = cellsOf({
      x: at.x - INK_RADIUS,
      y: at.y - INK_RADIUS,
      width: INK_THICKNESS,
      height: INK_THICKNESS,
    });
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) this.mark(c, r, flags, ink.drawing.id, ink.strength);
    }
  }
}
