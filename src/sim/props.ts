import Matter from "matter-js";
import { distanceToRect, expandRect, type Rect, rectCenter, rectsOverlap } from "../core/geometry";
import { WORLD } from "../core/world";
import type { LevelDefinition } from "../game/types";
import {
  BOUNDS_WALL_HEIGHT,
  BOUNDS_WALL_THICKNESS,
  KEY_RADIUS,
  REACH_RATIO,
  SOLID_FRICTION,
} from "./constants";
import { CATEGORY } from "./contacts";

const staticRect = (rect: Rect): Matter.Body => {
  const { x, y } = rectCenter(rect);
  return Matter.Bodies.rectangle(x, y, rect.width, rect.height, {
    isStatic: true,
    friction: SOLID_FRICTION,
    collisionFilter: { category: CATEGORY.world },
  });
};

const boundsWall = (x: number): Matter.Body =>
  staticRect({
    x,
    y: WORLD.height - BOUNDS_WALL_HEIGHT,
    width: BOUNDS_WALL_THICKNESS,
    height: BOUNDS_WALL_HEIGHT,
  });

/** The fixed furniture of a room: solids, page edges, door, key and exit. */
export class LevelProps {
  readonly anchorRects: readonly Rect[];
  keyTaken = false;

  private readonly paper: readonly Matter.Body[];
  private readonly fixtures: readonly Matter.Body[];
  private door: Matter.Body | null;

  constructor(
    private readonly world: Matter.World,
    private readonly level: LevelDefinition,
  ) {
    const paperDefs = level.solids.filter((solid) => solid.material === "paper");
    const glassDefs = level.solids.filter((solid) => solid.material === "glass");
    this.anchorRects = paperDefs.map((solid) => solid.rect);
    this.paper = paperDefs.map((solid) => staticRect(solid.rect));
    this.fixtures = [
      ...this.paper,
      ...glassDefs.map((solid) => staticRect(solid.rect)),
      boundsWall(-BOUNDS_WALL_THICKNESS),
      boundsWall(WORLD.width),
    ];
    this.door = level.door === undefined ? null : staticRect(level.door);
    Matter.Composite.add(world, [...this.fixtures, ...(this.door === null ? [] : [this.door])]);
  }

  get solidBodies(): readonly Matter.Body[] {
    return this.door === null ? this.fixtures : [...this.fixtures, this.door];
  }

  get doorOpen(): boolean {
    return this.level.door !== undefined && this.door === null;
  }

  isPaper(body: Matter.Body): boolean {
    return this.paper.includes(body);
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
    const { key } = this.level;
    if (key === undefined || this.keyTaken) return false;
    const reach = expandRect(aliceBounds, REACH_RATIO * aliceBounds.height);
    return distanceToRect(key, reach) <= KEY_RADIUS;
  }

  exitReachedBy(aliceBounds: Rect): boolean {
    return rectsOverlap(aliceBounds, this.level.exit);
  }
}
