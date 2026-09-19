import Matter from "matter-js";
import type { BoardDefinition } from "../board/types";
import { distanceToRect, expandRect, type Rect, rectCenter, rectsOverlap } from "../core/geometry";
import { KEY_RADIUS, REACH_RATIO, SOLID_FRICTION } from "./constants";
import { CATEGORY } from "./contacts";

const staticRect = (rect: Rect): Matter.Body => {
  const { x, y } = rectCenter(rect);
  return Matter.Bodies.rectangle(x, y, rect.width, rect.height, {
    isStatic: true,
    friction: SOLID_FRICTION,
    collisionFilter: { category: CATEGORY.world },
  });
};

/** What was sketched on the board before the player arrived: solids, door, key and goal. */
export class BoardProps {
  readonly anchorRects: readonly Rect[];
  readonly solidRects: readonly Rect[];
  keyTaken = false;

  private readonly marker: readonly Matter.Body[];
  private readonly fixtures: readonly Matter.Body[];
  private door: Matter.Body | null;

  constructor(
    private readonly world: Matter.World,
    private readonly board: BoardDefinition,
  ) {
    const markerDefs = board.solids.filter((solid) => solid.material === "marker");
    const glassDefs = board.solids.filter((solid) => solid.material === "glass");
    this.anchorRects = markerDefs.map((solid) => solid.rect);
    this.solidRects = board.solids.map((solid) => solid.rect);
    this.marker = markerDefs.map((solid) => staticRect(solid.rect));
    this.fixtures = [...this.marker, ...glassDefs.map((solid) => staticRect(solid.rect))];
    this.door = board.door === undefined ? null : staticRect(board.door);
    Matter.Composite.add(world, [...this.fixtures, ...(this.door === null ? [] : [this.door])]);
  }

  get solidBodies(): readonly Matter.Body[] {
    return this.door === null ? this.fixtures : [...this.fixtures, this.door];
  }

  get doorOpen(): boolean {
    return this.board.door !== undefined && this.door === null;
  }

  isMarker(body: Matter.Body): boolean {
    return this.marker.includes(body);
  }

  isDoor(body: Matter.Body): boolean {
    return this.door === body;
  }

  openDoor(): void {
    if (this.door === null) return;
    Matter.Composite.remove(this.world, this.door);
    this.door = null;
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
}
