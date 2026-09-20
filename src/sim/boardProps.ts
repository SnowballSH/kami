import Matter from "matter-js";
import type { BoardDefinition, SolidMaterial } from "../board/types";
import {
  distanceToRect,
  expandRect,
  type Rect,
  rectCenter,
  rectsOverlap,
  remainingColumns,
} from "../core/geometry";
import { KEY_RADIUS, REACH_RATIO, SOLID_FRICTION, SUMIKUI_SCAR_HEALS_MS } from "./constants";
import { CATEGORY } from "./contacts";

const staticRect = (rect: Rect): Matter.Body => {
  const { x, y } = rectCenter(rect);
  return Matter.Bodies.rectangle(x, y, rect.width, rect.height, {
    isStatic: true,
    friction: SOLID_FRICTION,
    collisionFilter: { category: CATEGORY.world },
  });
};

interface Piece {
  readonly rect: Rect;
  readonly body: Matter.Body;
  readonly material: SolidMaterial;
}

/** A mouthful taken out of one solid: a column through its full height. */
interface Scar {
  readonly rect: Rect;
  readonly bittenAt: number;
}

/**
 * What was sketched on the board before the player arrived: solids, door, key and goal. The
 * solids are paper the Sumikui can bite through; scars knit themselves back after a while.
 */
export class BoardProps {
  keyTaken = false;

  private pieces: readonly Piece[] = [];
  private scars: Scar[] = [];
  private door: Matter.Body | null;

  constructor(
    private readonly world: Matter.World,
    private readonly board: BoardDefinition,
  ) {
    this.door = board.door === undefined ? null : staticRect(board.door);
    if (this.door !== null) Matter.Composite.add(world, this.door);
    this.rebuildPieces();
  }

  /** Where ink may anchor: marker solids as they stand now, bites and all. */
  get anchorRects(): readonly Rect[] {
    return this.pieces.filter((piece) => piece.material === "marker").map(({ rect }) => rect);
  }

  get solidRects(): readonly Rect[] {
    return this.pieces.map(({ rect }) => rect);
  }

  get solidBodies(): readonly Matter.Body[] {
    return this.door === null ? this.paper : [...this.paper, this.door];
  }

  /** The sketched solids as they stand now: the paper the Sumikui may bite through. */
  get paper(): readonly Matter.Body[] {
    return this.pieces.map((piece) => piece.body);
  }

  /** Holes bitten out of the paper that have not healed yet. */
  get bites(): readonly Rect[] {
    return this.scars.map((scar) => scar.rect);
  }

  get doorOpen(): boolean {
    return this.board.door !== undefined && this.door === null;
  }

  isMarker(body: Matter.Body): boolean {
    return this.pieces.some((piece) => piece.body === body && piece.material === "marker");
  }

  isDoor(body: Matter.Body): boolean {
    return this.door === body;
  }

  openDoor(): void {
    if (this.door === null) return;
    Matter.Composite.remove(this.world, this.door);
    this.door = null;
  }

  /**
   * Bites a column `mouth` wide out of every solid `mouth` overlaps, clean through each slab.
   * Returns the holes it left, one per solid hit; nothing when it closed on empty paper.
   */
  bite(mouth: Rect, now: number): readonly Rect[] {
    const holes = this.board.solids
      .filter((solid) => rectsOverlap(mouth, solid.rect))
      .map(({ rect }) => ({ x: mouth.x, y: rect.y, width: mouth.width, height: rect.height }));
    if (holes.length === 0) return [];
    this.scars.push(...holes.map((rect) => ({ rect, bittenAt: now })));
    this.rebuildPieces();
    return holes;
  }

  /** Lets old scars close; returns how many did. */
  heal(now: number): number {
    const standing = this.scars.filter((scar) => now - scar.bittenAt < SUMIKUI_SCAR_HEALS_MS);
    const healed = this.scars.length - standing.length;
    if (healed === 0) return 0;
    this.scars = standing;
    this.rebuildPieces();
    return healed;
  }

  keyWithinReach(aliceBounds: Rect): boolean {
    const { key } = this.board;
    if (key === undefined || this.keyTaken) return false;
    const reach = expandRect(aliceBounds, REACH_RATIO * aliceBounds.height);
    return distanceToRect(key, reach) <= KEY_RADIUS;
  }

  goalReachedBy(aliceBounds: Rect): boolean {
    const { goal } = this.board;
    return goal !== undefined && rectsOverlap(aliceBounds, goal);
  }

  private rebuildPieces(): void {
    Matter.Composite.remove(
      this.world,
      this.pieces.map((piece) => piece.body),
    );
    const cuts = this.bites;
    this.pieces = this.board.solids.flatMap((solid) =>
      remainingColumns(solid.rect, cuts).map((rect) => ({
        rect,
        body: staticRect(rect),
        material: solid.material,
      })),
    );
    Matter.Composite.add(
      this.world,
      this.pieces.map((piece) => piece.body),
    );
  }
}
