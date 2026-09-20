import Matter from "matter-js";
import type { BoardDefinition } from "../board/types";
import type { Ruling } from "../cat/types";
import { distanceToRect, type Rect, type Vec } from "../core/geometry";
import { FIXED_STEP_MS, LOST_DISTANCE } from "../core/world";
import type { Drawing, DrawingId } from "../ink/types";
import { validPhysics } from "../rules/effectDomains";
import { EARTH, type WorldPhysics } from "../rules/types";
import { AliceController, type AliceSurroundings } from "./alice";
import { pullToward } from "./attraction";
import { BoardProps } from "./boardProps";
import { exactBounds } from "./bodyBounds";
import { Checkpoints } from "./checkpoints";
import {
  GRAVITY_SCALE,
  GROW_REFUSAL_COOLDOWN_MS,
  MIN_TIME_SCALE,
  SUMIKUI_BITE_DEPTH,
  SUMIKUI_BITE_WIDTH,
} from "./constants";
import { type Contact, contactsAt, contactsWith, toContact } from "./contacts";
import { EMPTY_BOARD } from "./emptyBoard";
import { bounceArcUnder, jumpArcUnder, walkSpeedAt } from "./flight";
import type { InkEntity } from "./inkEntity";
import { InkLayer } from "./inkLayer";
import { moveOfItself } from "./motion";
import { NATURES, type NatureWorld } from "./natures";
import { Sumikui } from "./sumikui";
import { Twins } from "./twins";
import {
  ALICE_SCALE,
  aliceDimensions,
  type BounceArc,
  type SimEvent,
  type Simulation,
  type WalkIntent,
  type WorldSnapshot,
} from "./types";
import { weather } from "./weather";
import { accelerationOf, push } from "./worldPhysics";

const IDLE: WalkIntent = { x: 0, y: 0 };

/** The Sumikui's mouth closing on the paper under a pair of feet. */
const mouthAt = (feet: Vec): Rect => ({
  x: feet.x - SUMIKUI_BITE_WIDTH / 2,
  y: feet.y - SUMIKUI_BITE_DEPTH / 2,
  width: SUMIKUI_BITE_WIDTH,
  height: SUMIKUI_BITE_DEPTH,
});
const HEADROOM_INSET = 1;

interface BoardWorld {
  readonly board: BoardDefinition;
  readonly engine: Matter.Engine;
  readonly props: BoardProps;
  readonly inks: InkLayer;
  readonly alice: AliceController;
  readonly twins: Twins;
  readonly checkpoints: Checkpoints;
  readonly activePairs: Matter.Pair[];
  readonly growthRefusedAt: Map<DrawingId, number>;
  readonly touchedAt: Map<DrawingId, number>;
  sumikui: Sumikui | null;
  goalReached: boolean;
  aliceLost: boolean;
}

/** Where Kami sets Alice down: the Sumikui will not eat there. */
const hallowedOf = (board: BoardDefinition): readonly Vec[] => [
  board.spawn,
  ...board.zones.map((zone) => zone.checkpoint),
];

const buildWorld = (board: BoardDefinition, physics: WorldPhysics): BoardWorld => {
  const engine = Matter.Engine.create();
  engine.gravity.scale = GRAVITY_SCALE;
  const props = new BoardProps(engine.world, board);
  const alice = new AliceController(board.spawn, physics);
  Matter.Composite.add(engine.world, alice.body);
  const twins = new Twins(engine.world);
  twins.match(physics.clones, alice, physics);

  const activePairs: Matter.Pair[] = [];
  const collectPairs = (event: Matter.IEventCollision<Matter.Engine>): void => {
    activePairs.push(...event.pairs);
  };
  Matter.Events.on(engine, "collisionStart", collectPairs);
  Matter.Events.on(engine, "collisionActive", collectPairs);

  return {
    board,
    engine,
    props,
    inks: new InkLayer(engine.world, props, physics),
    alice,
    twins,
    checkpoints: new Checkpoints(board),
    activePairs,
    growthRefusedAt: new Map(),
    touchedAt: new Map(),
    sumikui: physics.inkEater > 0 ? new Sumikui(alice, hallowedOf(board)) : null,
    goalReached: false,
    aliceLost: false,
  };
};

export class MatterSimulation implements Simulation {
  private physics: WorldPhysics = EARTH;
  private world: BoardWorld = buildWorld(EMPTY_BOARD, EARTH);
  private intent: WalkIntent = IDLE;
  private bulletTime = 1;
  private events: SimEvent[] = [];

  loadBoard(board: BoardDefinition): void {
    Matter.Engine.clear(this.world.engine);
    this.world = buildWorld(board, this.physics);
    this.events = [];
  }

  setPhysics(physics: WorldPhysics): void {
    if (!validPhysics(physics)) throw new RangeError("Invalid world physics");
    const { alice, twins, inks } = this.world;
    this.physics = physics;
    alice.applyPhysics(physics);
    twins.match(physics.clones, alice, physics);
    inks.setPhysics(physics);
    this.matchSumikui(physics.inkEater);
  }

  private matchSumikui(inkEater: number): void {
    const { sumikui, alice, board } = this.world;
    if (inkEater > 0 && sumikui === null)
      this.world.sumikui = new Sumikui(alice, hallowedOf(board));
    if (inkEater <= 0) this.world.sumikui = null;
  }

  addDrawing(drawing: Drawing): void {
    this.world.inks.add(drawing);
  }

  applyRuling(id: DrawingId, ruling: Ruling): void {
    this.world.inks.applyRuling(id, ruling);
  }

  removeDrawing(id: DrawingId): void {
    this.forgetInk(id);
  }

  setWalkIntent(intent: WalkIntent): void {
    this.intent = intent;
  }

  setTimeScale(scale: number): void {
    this.bulletTime = scale;
  }

  step(): readonly SimEvent[] {
    this.events = [];
    const timeScale = Math.max(this.bulletTime * this.physics.timeScale, MIN_TIME_SCALE);
    const ticks = Math.ceil(timeScale);
    for (let tick = 0; tick < ticks; tick++) this.tick(timeScale / ticks);
    return this.events;
  }

  snapshot(): WorldSnapshot {
    const { alice, twins, inks, props, sumikui } = this.world;
    return {
      alice: alice.snapshot(),
      twins: twins.snapshots(),
      sumikui: sumikui?.snapshot() ?? null,
      drawings: inks.poses,
      bites: props.bites,
      keyTaken: props.keyTaken,
      doorOpen: props.doorOpen,
    };
  }

  aliceBounds(): Rect {
    return this.world.alice.bounds();
  }

  walkSpeed(): number {
    return walkSpeedAt(this.world.alice.scale, this.physics.walkSpeed);
  }

  canFly(): boolean {
    return this.world.alice.flying;
  }

  bounceArc(strength: number): BounceArc {
    return bounceArcUnder(this.physics, strength);
  }

  jumpArc(): BounceArc {
    return jumpArcUnder(this.physics, this.world.alice.scale);
  }

  private tick(timeScale: number): void {
    const { alice, twins, engine, inks, activePairs } = this.world;
    const natureWorld = this.natureWorld();
    const elapsedMs = FIXED_STEP_MS * timeScale;
    activePairs.length = 0;
    engine.gravity.x = this.physics.gravity.x;
    engine.gravity.y = this.physics.gravity.y;
    engine.timing.timeScale = timeScale;

    this.growLawfully();
    const surroundings = this.surroundings();
    alice.control(this.intent, surroundings, timeScale);
    twins.control(this.intent, surroundings, timeScale);
    for (const ink of inks.all) NATURES[ink.nature].beforeStep?.(ink, natureWorld);
    moveOfItself(inks.all);
    this.blowWind();
    pullToward(alice.body.position, this.physics.attraction, inks.dynamicBodies);
    Matter.Engine.update(engine, FIXED_STEP_MS);
    alice.advanceResize(elapsedMs);
    const settled = this.surroundings();
    alice.sense(settled, this.intent);
    twins.settle(settled, this.intent, elapsedMs);

    this.resolveWeather(elapsedMs);
    this.resolveAliceTouches(natureWorld);
    this.resolveInkTouches(natureWorld);
    this.feedSumikui(elapsedMs);
    this.resolveProps();
    this.resolveWhereabouts();
  }

  private blowWind(): void {
    const { x, y } = this.physics.wind;
    if (x === 0 && y === 0) return;
    const wind = accelerationOf(this.physics.wind);
    for (const body of [this.world.alice.body, ...this.world.inks.dynamicBodies]) push(body, wind);
  }

  private forgetInk(id: DrawingId): void {
    this.world.inks.remove(id);
    this.world.touchedAt.delete(id);
  }

  private resolveWeather(elapsedMs: number): void {
    const { inks } = this.world;
    const { perished } = weather(this.physics.temperature, inks.all, elapsedMs);
    for (const ink of perished) {
      this.events.push({ type: "perished", drawingId: ink.id, nature: ink.nature });
      this.forgetInk(ink.id);
    }
  }

  private surroundings(): AliceSurroundings {
    const { inks, props } = this.world;
    const solidInk = inks.all.filter((ink) => NATURES[ink.nature].solidToAlice);
    const passableInk = inks.all.filter((ink) => !NATURES[ink.nature].solidToAlice);
    const natureOf = (body: Matter.Body) => {
      const ink = inks.find(body);
      return ink === undefined ? undefined : NATURES[ink.nature];
    };
    return {
      obstacles: [...props.solidBodies, ...solidInk.map((ink) => ink.body)],
      passables: passableInk.map((ink) => ink.body),
      isInk: (body) => inks.find(body) !== undefined,
      isSlippery: (body) => natureOf(body)?.slippery ?? false,
      isClimbable: (body) => natureOf(body)?.climbable ?? false,
    };
  }

  private natureWorld(): NatureWorld {
    const { alice, engine, inks, growthRefusedAt } = this.world;
    return {
      alice,
      gravity: accelerationOf(this.physics.gravity),
      intent: this.intent,
      feelers: {
        touches: (ink, offset) => this.feltBy(ink, offset),
        groundBelow: (ink, foot, drop) => this.groundBelow(ink, foot, drop),
      },
      emit: (event) => this.events.push(event),
      reachGoal: () => this.reachGoal(),
      loseAlice: () => {
        this.world.aliceLost = true;
      },
      consume: (ink) => this.forgetInk(ink.id),
      freeze: (ink) => inks.freeze(ink),
      refuseGrowth: (ink) => {
        const now = engine.timing.timestamp;
        const lastRefusedAt = growthRefusedAt.get(ink.id);
        growthRefusedAt.set(ink.id, now);
        if (lastRefusedAt !== undefined && now - lastRefusedAt <= GROW_REFUSAL_COOLDOWN_MS) return;
        this.events.push({ type: "grow-blocked", drawingId: ink.id });
      },
      hasHeadroomFor: (size, meal) =>
        this.hasHeadroomFor(alice, ALICE_SCALE[size] * this.physics.aliceSize, meal),
      pullToward: (ink, strengthInG) => {
        const loose = inks.dynamicBodies.filter((body) => body !== ink.body);
        pullToward(ink.body.position, strengthInG, [alice.body, ...loose]);
      },
    };
  }

  private feltBy(ink: InkEntity, offset: Vec): readonly Contact[] {
    return contactsAt(ink.body, offset, this.bodiesAround(ink));
  }

  private groundBelow(ink: InkEntity, foot: Vec, drop: number): boolean {
    const probe = Matter.Bodies.rectangle(foot.x, foot.y + drop / 2, 2, drop);
    return contactsWith(probe, this.bodiesAround(ink)).length > 0;
  }

  private bodiesAround(ink: InkEntity): readonly Matter.Body[] {
    const { alice, inks, props } = this.world;
    return [
      alice.body,
      ...props.solidBodies,
      ...inks.all.filter((other) => other !== ink).map((other) => other.body),
    ];
  }

  private aliceContacts(): readonly Contact[] {
    const { alice, activePairs } = this.world;
    const pairContacts = activePairs
      .filter(
        ({ collision }) => collision.parentA === alice.body || collision.parentB === alice.body,
      )
      .map(({ collision }) => toContact(alice.body, collision));
    return [...alice.contacts, ...pairContacts];
  }

  private resolveAliceTouches(natureWorld: NatureWorld): void {
    const { alice, inks, props } = this.world;
    const touched = new Map<InkEntity, Contact>();
    for (const contact of this.aliceContacts()) {
      if (props.isDoor(contact.body) && alice.hasKey) {
        props.openDoor();
        this.events.push({ type: "door-opened" });
      }
      const ink = inks.find(contact.body);
      if (ink !== undefined && !touched.has(ink)) touched.set(ink, contact);
    }
    for (const [ink, contact] of touched) {
      this.world.touchedAt.set(ink.id, this.world.engine.timing.timestamp);
      NATURES[ink.nature].onAliceTouch?.(ink, contact, natureWorld);
    }
  }

  private feedSumikui(elapsedMs: number): void {
    const { sumikui, alice, twins, inks, touchedAt, engine, props } = this.world;
    const now = engine.timing.timestamp;
    if (props.heal(now) > 0) this.events.push({ type: "paper-healed" });
    if (sumikui === null) return;
    const wasAwake = sumikui.isAwake;
    const meal = sumikui.tick(elapsedMs, {
      now,
      alices: [alice, ...twins.all],
      inks: inks.all,
      memory: touchedAt,
      paper: props.paper,
    });
    if (!wasAwake && sumikui.isAwake) this.events.push({ type: "sumikui-woke" });
    if (meal === null) return;
    switch (meal.kind) {
      case "ink":
        this.forgetInk(meal.ink.id);
        this.events.push({ type: "devoured", drawingId: meal.ink.id, nature: meal.ink.nature });
        return;
      case "paper":
        for (const hole of props.bite(mouthAt(meal.alice.feet()), now)) {
          this.events.push({ type: "paper-bitten", hole });
        }
        return;
      case "alice":
        this.world.aliceLost = true;
        this.events.push({ type: "alice-devoured" });
        return;
    }
  }

  private resolveInkTouches(natureWorld: NatureWorld): void {
    const { inks, props, activePairs } = this.world;
    const holdsInk = (surface: Matter.Body): boolean =>
      props.isMarker(surface) || (surface.isStatic && inks.find(surface) !== undefined);
    for (const { collision } of activePairs) {
      const sides = [
        [collision.parentA, collision.parentB],
        [collision.parentB, collision.parentA],
      ] as const;
      for (const [body, surface] of sides) {
        const ink = inks.find(body);
        if (ink !== undefined && holdsInk(surface)) {
          NATURES[ink.nature].onSurfaceTouch?.(ink, natureWorld);
        }
      }
    }
  }

  private resolveProps(): void {
    const { alice, props } = this.world;
    const bounds = alice.bounds();
    if (props.keyWithinReach(bounds)) {
      props.keyTaken = true;
      alice.hasKey = true;
      this.events.push({ type: "key-taken" });
    }
    if (props.goalReachedBy(bounds)) this.reachGoal();
  }

  private resolveWhereabouts(): void {
    const { alice, twins, board, checkpoints } = this.world;
    if (this.world.aliceLost || this.isAliceOffTheBoard()) {
      this.world.aliceLost = false;
      this.events.push({ type: "fell" });
      alice.placeAt(this.respawnPoint());
    }
    twins.recallLost(alice, board.killY);
    const zone = checkpoints.visit(alice.body.position.x);
    if (zone !== null) this.events.push({ type: "zone-entered", zoneId: zone.id });
  }

  private reachGoal(): void {
    if (this.world.goalReached) return;
    this.world.goalReached = true;
    this.events.push({ type: "goal-reached" });
  }

  private isAliceOffTheBoard(): boolean {
    const { alice, board, inks, props } = this.world;
    const { position } = alice.body;
    if (position.y > board.killY) return true;
    const isNear = (rect: Rect): boolean => distanceToRect(position, rect) <= LOST_DISTANCE;
    return !props.solidRects.some(isNear) && !inks.heldBounds.some(isNear);
  }

  private respawnPoint(): Vec {
    const { checkpoints, inks } = this.world;
    const marker = inks.spawnMarker;
    if (marker === undefined) return checkpoints.respawn;
    const bounds = exactBounds(marker.body);
    return { x: bounds.x + bounds.width / 2, y: bounds.y };
  }

  /** Grants each Alice the size the laws ask for; growing waits until nothing is overhead. */
  private growLawfully(): void {
    const { alice, twins } = this.world;
    for (const each of [alice, ...twins.all]) {
      const wanted = each.lawfulScale;
      if (wanted === each.headingScale) continue;
      if (wanted < each.headingScale || this.hasHeadroomFor(each, wanted))
        each.beginResize(each.size);
    }
  }

  private hasHeadroomFor(alice: AliceController, scale: number, meal?: InkEntity): boolean {
    const { inks, props } = this.world;
    const current = alice.bounds();
    const target = aliceDimensions("normal", scale);
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
  }
}
