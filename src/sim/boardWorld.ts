import Matter from "matter-js";
import type { BoardDefinition } from "../board/types";
import { distanceToRect, type Rect, type Vec } from "../core/geometry";
import { LOST_DISTANCE } from "../core/world";
import type { DrawingId } from "../ink/types";
import type { WorldPhysics } from "../rules/types";
import { AliceController } from "./alice";
import { BoardProps } from "./boardProps";
import { exactBounds } from "./bodyBounds";
import type { Tear } from "./boss/tear";
import { Checkpoints } from "./checkpoints";
import { GRAVITY_SCALE } from "./constants";
import { contactsWith } from "./contacts";
import { Footings, type LastFooting } from "./footing";
import type { InkEntity } from "./inkEntity";
import { InkLayer } from "./inkLayer";
import { NATURES } from "./natures";
import { PaperTurn } from "./paper";
import type { Portals } from "./portals";
import { Sumikui } from "./sumikui";
import { Twins } from "./twins";

const HEADROOM_INSET = 1;

/** Everything one loaded board holds; rebuilt from scratch by every `loadBoard`. */
export interface BoardWorld {
  readonly board: BoardDefinition;
  readonly engine: Matter.Engine;
  readonly props: BoardProps;
  readonly inks: InkLayer;
  /** How far this page is turned; a board opens upright, whatever the last one did. */
  readonly paper: PaperTurn;
  alice: AliceController;
  /** Where the heart hovers while she has no body; null once she is embodied. */
  soul: Vec | null;
  tear: Tear | null;
  readonly twins: Twins;
  readonly checkpoints: Checkpoints;
  readonly footings: Footings;
  readonly activePairs: Matter.Pair[];
  readonly growthRefusedAt: Map<DrawingId, number>;
  readonly portals: Map<AliceController, Portals>;
  sumikui: Sumikui | null;
  readonly goalReachedBy: Set<AliceController>;
  readonly lost: Set<AliceController>;
  benighted: boolean;
}

/** Where Kami sets Alice down: the Sumikui will not eat there. */
const hallowedOf = (board: BoardDefinition): readonly Vec[] => [
  board.spawn,
  ...board.zones.map((zone) => zone.checkpoint),
];

export const sumikuiFor = (world: BoardWorld, bides: boolean): Sumikui =>
  new Sumikui(world.alice, hallowedOf(world.board), world.board.killY, { bides });

export const buildWorld = (board: BoardDefinition, physics: WorldPhysics): BoardWorld => {
  const engine = Matter.Engine.create();
  engine.gravity.scale = GRAVITY_SCALE;
  const props = new BoardProps(engine.world, board);
  const alice = new AliceController(board.spawn, physics);
  Matter.Composite.add(engine.world, alice.body);
  const twins = new Twins(engine.world);
  twins.match(physics.clones, alice, physics);
  const paper = new PaperTurn();
  paper.obey(physics);

  const activePairs: Matter.Pair[] = [];
  const collectPairs = (event: Matter.IEventCollision<Matter.Engine>): void => {
    activePairs.push(...event.pairs);
  };
  Matter.Events.on(engine, "collisionStart", collectPairs);
  Matter.Events.on(engine, "collisionActive", collectPairs);

  const world: BoardWorld = {
    board,
    engine,
    props,
    inks: new InkLayer(engine.world, props, physics),
    paper,
    alice,
    soul: null,
    tear: null,
    twins,
    checkpoints: new Checkpoints(board),
    footings: new Footings(board.spawn),
    activePairs,
    growthRefusedAt: new Map(),
    portals: new Map(),
    sumikui: null,
    goalReachedBy: new Set(),
    lost: new Set(),
    benighted: false,
  };
  if (physics.inkEater > 0) world.sumikui = sumikuiFor(world, true);
  return world;
};

export const isOffTheBoard = (world: BoardWorld, position: Vec, footing: LastFooting): boolean => {
  const { board, inks, props } = world;
  if (position.y > board.killY) return true;
  if (board.page === "endless" && footing.fallen(position)) return true;
  const isNear = (rect: Rect): boolean => distanceToRect(position, rect) <= LOST_DISTANCE;
  return !props.solidRects.some(isNear) && !inks.heldBounds.some(isNear);
};

export const respawnPoint = (world: BoardWorld, footing: LastFooting): Vec => {
  const marker = world.inks.spawnMarker;
  if (marker === undefined) {
    return world.board.page === "endless" ? footing.respawn() : world.checkpoints.respawn;
  }
  const bounds = exactBounds(marker.body);
  return { x: bounds.x + bounds.width / 2, y: bounds.y };
};

/** Sets a vehicle down upright and at rest, its top centred on `feet`, so its driver lands aboard. */
export const seatUnder = (vehicle: InkEntity, feet: Vec): void => {
  const { body } = vehicle;
  Matter.Body.setAngle(body, 0);
  const bounds = exactBounds(body);
  Matter.Body.setPosition(body, {
    x: body.position.x + feet.x - (bounds.x + bounds.width / 2),
    y: body.position.y + feet.y - bounds.y,
  });
  Matter.Body.setVelocity(body, { x: 0, y: 0 });
  Matter.Body.setAngularVelocity(body, 0);
};

/** Whether nothing held overhead stops `alice` growing to `scale`; `meal` is the ink she would eat to do it. */
export const hasHeadroom = (
  world: BoardWorld,
  alice: AliceController,
  scale: number,
  meal?: InkEntity,
): boolean => {
  const { inks, props } = world;
  const current = alice.bounds();
  const factor = scale / alice.scale;
  const target = { width: current.width * factor, height: current.height * factor };
  if (target.height <= current.height && target.width <= current.width) return true;
  const headroom = Matter.Bodies.rectangle(
    current.x + current.width / 2,
    current.y + current.height - target.height / 2,
    target.width - 2 * HEADROOM_INSET,
    target.height - 2 * HEADROOM_INSET,
  );
  const ceilings = [
    ...props.solidBodies,
    ...inks.all
      .filter((ink) => ink !== meal && ink.body.isStatic && NATURES[ink.nature].solidToAlice)
      .map((ink) => ink.body),
  ];
  return contactsWith(headroom, ceilings).length === 0;
};
