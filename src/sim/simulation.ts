import Matter from "matter-js";
import type { Ruling } from "../cat/types";
import type { Rect } from "../core/geometry";
import type { PhysicsState } from "../core/physics";
import { FIXED_STEP_MS } from "../core/world";
import type { LevelDefinition } from "../game/types";
import type { Drawing, DrawingId } from "../ink/types";
import { AliceController, type AliceSurroundings } from "./alice";
import { BLANK_LEVEL } from "./blankLevel";
import { exactBounds } from "./bodyBounds";
import { BOUNCE_SPEED, GROW_REFUSAL_COOLDOWN_MS } from "./constants";
import { type Contact, contactsWith, toContact } from "./contacts";
import type { InkEntity } from "./inkEntity";
import { InkLayer } from "./inkLayer";
import { Laws } from "./laws";
import { NATURES, type NatureWorld } from "./natures";
import { LevelProps } from "./props";
import {
  ALICE_BASE,
  ALICE_SCALE,
  type AliceSize,
  type BounceArc,
  type DrawingBodyFact,
  type SimEvent,
  type Simulation,
  type WalkIntent,
  type WorldSnapshot,
} from "./types";

const IDLE: WalkIntent = { x: 0, y: 0 };
const HEADROOM_INSET = 1;

interface Room {
  readonly level: LevelDefinition;
  readonly engine: Matter.Engine;
  readonly props: LevelProps;
  readonly inks: InkLayer;
  readonly alice: AliceController;
  readonly activePairs: Matter.Pair[];
  readonly growthRefusedAt: Map<DrawingId, number>;
  exitReached: boolean;
}

const buildRoom = (level: LevelDefinition, laws: Laws): Room => {
  const engine = Matter.Engine.create();
  const props = new LevelProps(engine.world, level);
  const alice = new AliceController(level.spawn, laws);
  Matter.Composite.add(engine.world, alice.body);

  const activePairs: Matter.Pair[] = [];
  const collectPairs = (event: Matter.IEventCollision<Matter.Engine>): void => {
    activePairs.push(...event.pairs);
  };
  Matter.Events.on(engine, "collisionStart", collectPairs);
  Matter.Events.on(engine, "collisionActive", collectPairs);

  return {
    level,
    engine,
    props,
    inks: new InkLayer(engine.world, props.anchorRects, laws),
    alice,
    activePairs,
    growthRefusedAt: new Map(),
    exitReached: false,
  };
};

export class MatterSimulation implements Simulation {
  private readonly laws = new Laws();
  private room: Room;
  private intent: WalkIntent = IDLE;
  private bulletTimeScale = 1;
  private events: SimEvent[] = [];

  constructor() {
    this.room = buildRoom(BLANK_LEVEL, this.laws);
    this.applyLaws();
  }

  loadLevel(level: LevelDefinition): void {
    Matter.Engine.clear(this.room.engine);
    this.room = buildRoom(level, this.laws);
    this.intent = IDLE;
    this.events = [];
    this.applyLaws();
  }

  addDrawing(drawing: Drawing): void {
    this.room.inks.add(drawing);
  }

  applyRuling(id: DrawingId, ruling: Ruling): void {
    this.room.inks.applyRuling(id, ruling);
  }

  removeDrawing(id: DrawingId): void {
    this.room.inks.remove(id);
  }

  setWalkIntent(intent: WalkIntent): void {
    this.intent = intent;
  }

  setTimeScale(scale: number): void {
    this.bulletTimeScale = scale;
    this.applyLaws();
  }

  physics(): PhysicsState {
    return this.laws.current;
  }

  setPhysics(patch: Partial<PhysicsState>): void {
    this.laws.set(patch);
    this.applyLaws();
  }

  resetPhysics(): void {
    this.laws.reset();
    this.applyLaws();
  }

  walkSpeed(): number {
    return this.room.alice.walkSpeed();
  }

  resizeAlice(size: AliceSize): void {
    if (this.hasHeadroomFor(size)) this.room.alice.beginResize(size);
  }

  bounceArc(strength: number): BounceArc {
    return this.laws.arcOf(BOUNCE_SPEED * Math.sqrt(strength));
  }

  drawingFacts(): readonly DrawingBodyFact[] {
    return this.room.inks.all.map((ink) => ({
      id: ink.id,
      bounds: exactBounds(ink.body),
      isStatic: ink.body.isStatic,
    }));
  }

  step(): readonly SimEvent[] {
    const { alice, engine, inks, activePairs } = this.room;
    const natureWorld = this.natureWorld();
    const timeScale = engine.timing.timeScale;
    this.events = [];
    activePairs.length = 0;

    alice.control(this.intent, this.surroundings(), timeScale);
    for (const ink of inks.all) NATURES[ink.nature].beforeStep?.(ink, natureWorld);
    this.laws.blow([alice.body, ...inks.all.map((ink) => ink.body)]);
    Matter.Engine.update(engine, FIXED_STEP_MS);
    alice.advanceResize(FIXED_STEP_MS * timeScale);
    alice.sense(this.surroundings(), this.intent);

    this.resolveAliceTouches(natureWorld);
    this.resolveInkTouches(natureWorld);
    this.resolveProps();
    return this.events;
  }

  snapshot(): WorldSnapshot {
    const { alice, inks, props } = this.room;
    return {
      alice: alice.snapshot(),
      drawings: inks.poses,
      keyTaken: props.keyTaken,
      doorOpen: props.doorOpen,
    };
  }

  aliceBounds(): Rect {
    return this.room.alice.bounds();
  }

  private surroundings(): AliceSurroundings {
    const { inks, props } = this.room;
    const solidInk = inks.all.filter((ink) => NATURES[ink.nature].solidToAlice);
    const climbableInk = inks.all.filter((ink) => !NATURES[ink.nature].solidToAlice);
    return {
      obstacles: [...props.solidBodies, ...solidInk.map((ink) => ink.body)],
      climbables: climbableInk.map((ink) => ink.body),
      isInk: (body) => inks.find(body) !== undefined,
      isSlippery: (body) => {
        const ink = inks.find(body);
        return ink !== undefined && NATURES[ink.nature].slippery;
      },
    };
  }

  private applyLaws(): void {
    const { engine, alice, inks, props } = this.room;
    this.laws.applyTo(engine, this.bulletTimeScale);
    this.laws.dressAlice(alice.body);
    for (const solid of props.solidBodies) this.laws.dressSolid(solid);
    inks.redress();
  }

  private natureWorld(): NatureWorld {
    const { alice, engine, inks, growthRefusedAt } = this.room;
    return {
      alice,
      gravityPerMass: this.laws.gravityPerMass,
      emit: (event) => this.events.push(event),
      consume: (ink) => inks.remove(ink.id),
      freeze: (ink) => inks.freeze(ink),
      refuseGrowth: (ink) => {
        const now = engine.timing.timestamp;
        const lastRefusedAt = growthRefusedAt.get(ink.id);
        growthRefusedAt.set(ink.id, now);
        if (lastRefusedAt !== undefined && now - lastRefusedAt <= GROW_REFUSAL_COOLDOWN_MS) return;
        this.events.push({ type: "grow-blocked", drawingId: ink.id });
      },
      hasHeadroomFor: (size) => this.hasHeadroomFor(size),
    };
  }

  private aliceContacts(): readonly Contact[] {
    const { alice, activePairs } = this.room;
    const pairContacts = activePairs
      .filter(
        ({ collision }) => collision.parentA === alice.body || collision.parentB === alice.body,
      )
      .map(({ collision }) => toContact(alice.body, collision));
    return [...alice.contacts, ...pairContacts];
  }

  private resolveAliceTouches(natureWorld: NatureWorld): void {
    const { alice, inks, props } = this.room;
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
      NATURES[ink.nature].onAliceTouch?.(ink, contact, natureWorld);
    }
  }

  private resolveInkTouches(natureWorld: NatureWorld): void {
    const { inks, props, activePairs } = this.room;
    const holdsInk = (surface: Matter.Body): boolean =>
      props.isPaper(surface) || (surface.isStatic && inks.find(surface) !== undefined);
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
    const { alice, props, level } = this.room;
    const bounds = alice.bounds();
    if (props.keyWithinReach(bounds)) {
      props.keyTaken = true;
      alice.hasKey = true;
      this.events.push({ type: "key-taken" });
    }
    if (!this.room.exitReached && props.exitReachedBy(bounds)) {
      this.room.exitReached = true;
      this.events.push({ type: "exit-reached" });
    }
    if (alice.body.position.y > level.killY) {
      this.events.push({ type: "fell" });
      alice.placeAt(level.spawn);
    }
  }

  private hasHeadroomFor(size: AliceSize): boolean {
    const { alice, inks, props } = this.room;
    const current = alice.bounds();
    const targetHeight = ALICE_BASE.height * ALICE_SCALE[size];
    const extraHeight = targetHeight - current.height;
    if (extraHeight <= 0) return true;
    const headroom = Matter.Bodies.rectangle(
      current.x + current.width / 2,
      current.y - extraHeight / 2,
      current.width - 2 * HEADROOM_INSET,
      extraHeight - 2 * HEADROOM_INSET,
    );
    const ceilings = [
      ...props.solidBodies,
      ...inks.all.map((ink) => ink.body).filter((body) => body.isStatic),
    ];
    return contactsWith(headroom, ceilings).length === 0;
  }
}
