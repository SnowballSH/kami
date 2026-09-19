import { poseToWorld, type Rect, type Vec } from "../core/geometry";
import { INK_THICKNESS, WORLD } from "../core/world";
import type { DrawingId } from "../ink/types";
import { NATURE_FOOTING } from "../sim/types";
import type { Scene } from "./types";

export const CELL_PX = 8;
export const COLS = Math.ceil(WORLD.width / CELL_PX);
export const ROWS = Math.ceil(WORLD.height / CELL_PX);

export const CellFlag = {
  solid: 1,
  fixture: 2,
  climbable: 4,
  bouncy: 8,
  edible: 16,
  door: 32,
} as const;

const INK_RADIUS = INK_THICKNESS / 2;
const STAMP_SPACING = CELL_PX / 2;

export interface CellRange {
  readonly c0: number;
  readonly c1: number;
  readonly r0: number;
  readonly r1: number;
}

/** Grid cells [c0, c1) × [r0, r1) touched by a world rect, clipped to the page. */
export const cellsOf = (rect: Rect): CellRange => ({
  c0: Math.max(0, Math.floor(rect.x / CELL_PX)),
  c1: Math.min(COLS, Math.ceil((rect.x + rect.width) / CELL_PX)),
  r0: Math.max(0, Math.floor(rect.y / CELL_PX)),
  r1: Math.min(ROWS, Math.ceil((rect.y + rect.height) / CELL_PX)),
});

const flagsFor = (nature: keyof typeof NATURE_FOOTING): number => {
  const footing = NATURE_FOOTING[nature];
  let flags = 0;
  if (footing.solid) flags |= CellFlag.solid;
  if (footing.climbable) flags |= CellFlag.climbable;
  if (footing.edible) flags |= CellFlag.edible;
  if (nature === "bouncy") flags |= CellFlag.bouncy;
  return flags;
};

/** The page rasterised the way Alice's feet read it: what is solid, what holds, what springs. */
export class Chart {
  private readonly cells = new Uint8Array(COLS * ROWS);
  private readonly bouncyStrength = new Float32Array(COLS * ROWS);
  private readonly edibleOwner = new Map<number, DrawingId>();

  static of(scene: Scene): Chart {
    const chart = new Chart();
    for (const solid of scene.level.solids) {
      chart.stampRect(solid.rect, CellFlag.solid | CellFlag.fixture);
    }
    if (scene.level.door !== undefined && !scene.doorOpen) {
      chart.stampRect(scene.level.door, CellFlag.solid | CellFlag.fixture | CellFlag.door);
    }
    for (const ink of scene.inks) chart.stampInk(ink.drawing.id, ink, flagsFor(ink.nature));
    return chart;
  }

  at(c: number, r: number): number {
    if (c < 0 || c >= COLS) return CellFlag.solid | CellFlag.fixture;
    if (r < 0 || r >= ROWS) return 0;
    return this.cells[r * COLS + c] ?? 0;
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
    for (let c = c0; c < c1; c++) best = Math.max(best, this.bouncyStrength[r * COLS + c] ?? 0);
    return best;
  }

  edibleIn(range: CellRange): DrawingId | null {
    for (let r = range.r0; r < range.r1; r++) {
      for (let c = range.c0; c < range.c1; c++) {
        const owner = this.edibleOwner.get(r * COLS + c);
        if (owner !== undefined) return owner;
      }
    }
    return null;
  }

  private mark(index: number, flags: number): void {
    this.cells[index] = (this.cells[index] ?? 0) | flags;
  }

  private stampRect(rect: Rect, flags: number): void {
    const { c0, c1, r0, r1 } = cellsOf(rect);
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) this.mark(r * COLS + c, flags);
    }
  }

  private stampInk(id: DrawingId, ink: Scene["inks"][number], flags: number): void {
    for (const stroke of ink.drawing.strokes) {
      let previous: Vec | null = null;
      for (const point of stroke) {
        const here = poseToWorld(point, ink.pose);
        if (previous === null) this.stampDot(id, here, flags, ink.strength);
        else this.stampSegment(id, previous, here, flags, ink.strength);
        previous = here;
      }
    }
  }

  private stampSegment(id: DrawingId, from: Vec, to: Vec, flags: number, strength: number): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / STAMP_SPACING));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.stampDot(
        id,
        { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
        flags,
        strength,
      );
    }
  }

  private stampDot(id: DrawingId, at: Vec, flags: number, strength: number): void {
    const { c0, c1, r0, r1 } = cellsOf({
      x: at.x - INK_RADIUS,
      y: at.y - INK_RADIUS,
      width: INK_THICKNESS,
      height: INK_THICKNESS,
    });
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        const index = r * COLS + c;
        this.mark(index, flags);
        if (flags & CellFlag.bouncy) {
          this.bouncyStrength[index] = Math.max(this.bouncyStrength[index] ?? 0, strength);
        }
        if (flags & CellFlag.edible) this.edibleOwner.set(index, id);
      }
    }
  }
}
