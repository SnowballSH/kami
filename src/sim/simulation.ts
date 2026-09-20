import Matter from "matter-js";
import type { BoardDefinition } from "../board/types";
import type { Ruling } from "../cat/types";
import { distanceToRect, type Rect, type Stroke, type Vec } from "../core/geometry";
import { FIXED_STEP_MS, LOST_DISTANCE } from "../core/world";
import type { Drawing, DrawingId } from "../ink/types";
import { validPhysics } from "../rules/effectDomains";
import { EARTH, type WorldPhysics } from "../rules/types";
import { AliceController, type AliceSurroundings } from "./alice";
import { pullToward } from "./attraction";
import { BoardProps } from "./boardProps";
import { cutCrosses, incarnate } from "./body/drawnBody";
import type { BodyPartKind, Cut } from "./body/types";
import { exactBounds } from "./bodyBounds";
import type { Prey } from "./boss/snipper";
import { Tear, type TearDeed } from "./boss/tear";
import { SOUL_HOVER_PX, TEAR_TUNING } from "./boss/tuning";
import { blowFrom } from "./boss/weapons";
import { Checkpoints } from "./checkpoints";
import {
  GRAVITY_SCALE,
  GROW_REFUSAL_COOLDOWN_MS,
  MIN_TIME_SCALE,
  SUMIKUI_BITE_DEPTH,
  SUMIKUI_BITE_WIDTH,
} from "./constants";
import { type Contact, contactsAt, contactsWith, toContact } from "./contacts";
import type { Feelers } from "./creatures";
import { EMPTY_BOARD } from "./emptyBoard";
import { bounceArcUnder, jumpArcUnder, walkSpeedAt } from "./flight";
import { LastFooting } from "./footing";
import type { InkEntity } from "./inkEntity";
import { InkLayer } from "./inkLayer";
import { moveOfItself } from "./motion";
import { NATURES, type NatureWorld, stepOf } from "./natures";
import { seesHerWay } from "./nightfall";
import { isLooseInk, PaperTurn } from "./paper";
import { centreOf, Portals } from "./portals";
import { restingFeet } from "./restingFeet";
import { Sumikui } from "./sumikui";
import { Twins } from "./twins";
import {
  ALICE_HERSELF,
  ALICE_SCALE,
  type AliceIndex,
  type AliceSnapshot,
  aliceDimensions,
  type BounceArc,
  type InkProvenance,
  type Ride,
  type SimEvent,
  type Simulation,
  type WalkIntent,
  type WorldSnapshot,
} from "./types";
import { liftsHer, rideOn } from "./vehicles";
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

/** Every Alice on the board, Alice herself first, then her twins in order. */
type Roster = readonly [AliceController, ...AliceController[]];

interface BoardWorld {
  readonly board: BoardDefinition;
  readonly engine: Matter.Engine;
  readonly props: BoardProps;
  readonly inks: InkLayer;
  alice: AliceController;
  /** Where the heart hovers while she has no body; null once she is embodied. */
  soul: Vec | null;
  tear: Tear | null;
  readonly twins: Twins;
  readonly checkpoints: Checkpoints;
  readonly footing: LastFooting;
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
    soul: null,
    tear: null,
    twins,
    checkpoints: new Checkpoints(board),
    footing: new LastFooting(board.spawn),
    activePairs,
    growthRefusedAt: new Map(),
    portals: new Map(),
    sumikui:
      physics.inkEater > 0
        ? new Sumikui(alice, hallowedOf(board), board.killY, { bides: true })
        : null,
    goalReachedBy: new Set(),
    lost: new Set(),
    benighted: false,
  };
};

export class MatterSimulation implements Simulation {
  private physics: WorldPhysics = EARTH;
  private world: BoardWorld = buildWorld(EMPTY_BOARD, EARTH);
  private intents: WalkIntent[] = [];
  private readonly rides = new Map<AliceController, Ride>();
  private roster: Roster | null = null;
  private bulletTime = 1;
  private readonly paper = new PaperTurn();
  private events: SimEvent[] = [];
  /** False until the first step after a board opens: laws folded before then were born with the room. */
  private underway = false;

  loadBoard(board: BoardDefinition): void {
    Matter.Engine.clear(this.world.engine);
    this.world = buildWorld(board, this.physics);
    this.roster = null;
    this.events = [];
    this.rides.clear();
    this.underway = false;
  }

  setPhysics(physics: WorldPhysics): void {
    if (!validPhysics(physics)) throw new RangeError("Invalid world physics");
    const { alice, twins, inks } = this.world;
    this.physics = physics;
    this.paper.obey(physics);
    alice.applyPhysics(physics);
    twins.match(this.embodied ? physics.clones : 0, alice, physics);
    this.roster = null;
    inks.setPhysics(physics);
    this.matchSumikui(physics.inkEater, { bides: !this.underway });
  }

  private matchSumikui(inkEater: number, { bides }: { readonly bides: boolean }): void {
    const { sumikui, alice, board } = this.world;
    if (inkEater > 0 && sumikui === null)
      this.world.sumikui = new Sumikui(alice, hallowedOf(board), board.killY, { bides });
    if (inkEater <= 0) this.world.sumikui = null;
  }

  addDrawing(drawing: Drawing, provenance: InkProvenance = "drawn"): void {
    this.world.inks.add(drawing, provenance);
  }

  applyRuling(id: DrawingId, ruling: Ruling): void {
    this.world.inks.applyRuling(id, ruling);
  }

  removeDrawing(id: DrawingId): void {
    this.forgetInk(id);
  }

  disembody(): void {
    const { alice, engine, board, twins } = this.world;
    const heart = alice.heart();
    const seat = this.world.soul ?? { x: heart.x, y: heart.y - SOUL_HOVER_PX };
    Matter.Composite.remove(engine.world, alice.body);
    const soul = new AliceController(board.spawn, this.physics);
    soul.placeAt({ x: seat.x, y: seat.y + soul.bounds().height / 2 });
    this.world.alice = soul;
    this.world.soul = seat;
    twins.match(0, soul, this.physics);
    this.roster = null;
    this.world.sumikui = null;
    this.matchSumikui(this.physics.inkEater, { bides: true });
  }

  incarnate(id: DrawingId, name: string, strokes?: readonly Stroke[]): boolean {
    const { inks, engine, alice, twins, props } = this.world;
    const ink = inks.all.find((each) => each.id === id);
    if (ink === undefined) return false;
    const seat = this.world.soul ?? alice.heart();
    const born = incarnate(strokes ?? ink.worldStrokes, seat, name, engine.timing.timestamp);
    this.forgetInk(id);
    Matter.Composite.remove(engine.world, alice.body);
    const bornFrame = {
      x: born.centre.x - born.body.frame.width / 2,
      y: born.centre.y - born.body.frame.height / 2,
      width: born.body.frame.width,
      height: born.body.frame.height,
    };
    const solidInk = inks.all.filter((each) => NATURES[each.nature].solidToAlice);
    const feet = restingFeet(bornFrame, [
      ...props.solidRects,
      ...solidInk.map((each) => exactBounds(each.body)),
    ]);
    const embodied = new AliceController(
      { x: born.centre.x, y: feet },
      this.physics,
      born.body.frame,
    );
    embodied.wear(born.body, name);
    Matter.Composite.add(engine.world, embodied.body);
    this.world.alice = embodied;
    this.world.soul = null;
    twins.match(this.physics.clones, embodied, this.physics);
    this.roster = null;
    this.world.sumikui = null;
    this.matchSumikui(this.physics.inkEater, { bides: true });
    return true;
  }

  graft(strokes: readonly Stroke[]): boolean {
    if (this.world.soul !== null) return false;
    const grafted = this.world.alice.graft(strokes);
    if (grafted === null) return false;
    if (grafted.restored.length > 0)
      this.events.push({ type: "part-restored", parts: grafted.restored });
    return true;
  }

  openTear(): void {
    const heart = this.world.soul ?? this.world.alice.heart();
    const top = this.world.board.page === "arena" ? -(this.world.board.killY - 200) : -Infinity;
    this.world.tear = new Tear({
      x: heart.x,
      y: Math.max(heart.y - TEAR_TUNING.aboveHeart, top + 120),
    });
  }

  setWalkIntent(intent: WalkIntent, who: AliceIndex = ALICE_HERSELF): void {
    this.intents[who] = intent;
  }

  setTimeScale(scale: number): void {
    this.bulletTime = scale;
  }

  step(): readonly SimEvent[] {
    this.underway = true;
    const timeScale = Math.max(this.bulletTime * this.physics.timeScale, MIN_TIME_SCALE);
    const ticks = Math.ceil(timeScale);
    for (let tick = 0; tick < ticks; tick++) this.tick(timeScale / ticks);
    const events = this.events;
    this.events = [];
    return events;
  }

  snapshot(): WorldSnapshot {
    const { alice, soul, tear, twins, inks, props, sumikui } = this.world;
    return {
      alice: soul === null ? alice.snapshot() : null,
      soul: soul === null ? null : { at: soul },
      tear: tear?.snapshot() ?? null,
      twins: twins.snapshots(),
      sumikui: sumikui?.snapshot(this.everyAlice()) ?? null,
      drawings: inks.poses,
      bites: props.bites,
      keyTaken: props.keyTaken,
      doorOpen: props.doorOpen,
    };
  }

  alices(): readonly AliceSnapshot[] {
    return this.bodied().map((alice) => alice.snapshot());
  }

  aliceBounds(who: AliceIndex = ALICE_HERSELF): Rect {
    return this.aliceAt(who).bounds();
  }

  paperAngle(): number {
    return this.paper.angle;
  }

  walkSpeed(who: AliceIndex = ALICE_HERSELF): number {
    return walkSpeedAt(this.aliceAt(who).scale, this.physics.walkSpeed);
  }

  canFly(): boolean {
    return this.world.alice.flying;
  }

  bounceArc(strength: number): BounceArc {
    return bounceArcUnder(this.physics, strength);
  }

  jumpArc(who: AliceIndex = ALICE_HERSELF): BounceArc {
    return jumpArcUnder(this.physics, this.aliceAt(who).scale);
  }

  private everyAlice(): Roster {
    const { alice, twins } = this.world;
    this.roster ??= [alice, ...twins.all];
    return this.roster;
  }

  /** Every Alice who has a body to move: nobody while the player is a soul. */
  private bodied(): readonly AliceController[] {
    return this.embodied ? this.everyAlice() : [];
  }

  private aliceAt(who: AliceIndex): AliceController {
    const alice = this.everyAlice()[who];
    if (alice === undefined) throw new RangeError(`No Alice numbered ${who}`);
    return alice;
  }

  private intentOf(alice: AliceController): WalkIntent {
    return this.intents[this.everyAlice().indexOf(alice)] ?? IDLE;
  }

  private get embodied(): boolean {
    return this.world.soul === null;
  }

  private tick(timeScale: number): void {
    const { engine, inks, activePairs } = this.world;
    const alices = this.bodied();
    const elapsedMs = FIXED_STEP_MS * timeScale;
    activePairs.length = 0;
    engine.gravity.x = this.physics.gravity.x;
    engine.gravity.y = this.physics.gravity.y;
    engine.timing.timeScale = timeScale;

    this.growLawfully();
    const surroundings = this.surroundings();
    for (const alice of alices) {
      const ride = alice.snapshot().ride;
      if (ride !== null) this.rides.set(alice, ride);
      else if (alice.grounded) this.rides.delete(alice);
    }
    for (const alice of alices) {
      alice.control(this.intentSheCanFollow(alice), surroundings, timeScale);
    }
    for (const ink of inks.all) stepOf(ink)?.(ink, this.natureWorld(this.nearestAliceTo(ink)));
    moveOfItself(inks.all);
    this.blowWind();
    this.tumbleLooseInk();
    for (const alice of alices) {
      pullToward(alice.body.position, this.physics.attraction, inks.dynamicBodies);
    }
    Matter.Engine.update(engine, FIXED_STEP_MS);
    this.paper.advance(this.physics, elapsedMs);
    const settled = this.surroundings();
    for (const alice of alices) {
      alice.advanceResize(elapsedMs);
      alice.sense(settled, this.intentSheCanFollow(alice));
    }

    this.resolveWeather(elapsedMs);
    for (const alice of alices) this.resolveAliceTouches(alice);
    this.resolveInkTouches(this.natureWorld(this.world.alice));
    this.feedSumikui(elapsedMs);
    for (const alice of alices) this.resolveProps(alice);
    this.fight(elapsedMs);
    this.resolveWhereabouts();
  }

  private prey(): Prey | null {
    const { alice, soul } = this.world;
    const body = alice.drawnBody;
    if (soul !== null || body === null) return null;
    const space = alice.bodySpace();
    return {
      heart: alice.heart(),
      body,
      centre: space.centre,
      facing: space.facing,
      scale: space.scale,
    };
  }

  private fight(elapsedMs: number): void {
    const { tear } = this.world;
    if (tear === null) return;
    for (const deed of tear.tick(elapsedMs, this.prey())) this.answer(tear, deed);
    this.strike(tear);
  }

  private answer(tear: Tear, deed: TearDeed): void {
    switch (deed.kind) {
      case "servant-came":
        this.events.push({ type: "servant-came" });
        return;
      case "wave":
        this.events.push({ type: "servants-came", lessers: deed.lessers });
        return;
      case "servant-perished":
        this.events.push({ type: "servant-perished", rank: deed.rank });
        return;
      case "closed":
        this.world.tear = null;
        this.events.push({ type: "tear-closed" });
        return;
      case "cut":
        this.suffer(tear, deed.cut, deed.part);
        return;
    }
  }

  /** A drawing across the cut takes it instead of her; otherwise the blades reach her body. */
  private suffer(tear: Tear, cut: Cut, part: BodyPartKind): void {
    const shield = this.world.inks.all.find((ink) =>
      ink.worldStrokes.some((stroke) => cutCrosses(cut, stroke)),
    );
    if (shield !== undefined) {
      this.forgetInk(shield.id);
      this.events.push({ type: "shielded", drawingId: shield.id });
      return;
    }
    const snipped = this.embodied ? this.world.alice.snip(cut, part) : null;
    if (snipped === null) {
      this.events.push({ type: "snip-missed" });
      return;
    }
    if (snipped.heartCut) {
      tear.landed(cut);
      this.disembody();
      this.world.tear = null;
      this.events.push({ type: "heart-swallowed" });
      return;
    }
    if (snipped.removed.length === 0) {
      this.events.push({ type: "snip-missed" });
      return;
    }
    tear.landed(cut);
    this.events.push({ type: "snipped", part, lost: snipped.lost });
  }

  private strike(tear: Tear): void {
    for (const snipper of tear.alive) {
      for (const ink of this.world.inks.all) {
        const blow = blowFrom(ink, snipper.where, snipper.radius);
        if (blow === null || !tear.hurt(snipper, blow.damage, blow.from)) continue;
        this.events.push({ type: "servant-struck", rank: snipper.rank, drawingId: ink.id });
        break;
      }
    }
  }

  private nearestAliceTo(ink: InkEntity): AliceController {
    const { position } = ink.body;
    let nearest = this.world.alice;
    let gap = Number.POSITIVE_INFINITY;
    for (const alice of this.everyAlice()) {
      const d = distanceToRect(position, alice.bounds());
      if (d < gap) {
        gap = d;
        nearest = alice;
      }
    }
    return nearest;
  }

  private intentSheCanFollow(alice: AliceController): WalkIntent {
    const intent = this.intentOf(alice);
    if (seesHerWay(this.physics, alice.body.position, this.world.inks.all)) return intent;
    const meantToMove = intent.x !== 0 || intent.y !== 0;
    if (meantToMove && !this.world.benighted) {
      this.world.benighted = true;
      this.events.push({ type: "in-the-dark" });
    }
    return IDLE;
  }

  private blowWind(): void {
    const { x, y } = this.physics.wind;
    if (x === 0 && y === 0) return;
    const wind = accelerationOf(this.physics.wind);
    const bodies = [...this.bodied().map((alice) => alice.body), ...this.world.inks.dynamicBodies];
    for (const body of bodies) push(body, wind);
  }

  private tumbleLooseInk(): void {
    const loose = this.world.inks.all
      .filter((ink) => !ink.body.isStatic && isLooseInk(ink.nature))
      .map((ink) => ink.body);
    this.paper.tumble(this.physics.gravity, loose);
  }

  private forgetInk(id: DrawingId): void {
    this.world.inks.remove(id);
    for (const portals of this.world.portals.values()) portals.forget(id);
  }

  private portalsOf(alice: AliceController): Portals {
    const { portals } = this.world;
    const own = portals.get(alice) ?? new Portals(this.everyAlice().indexOf(alice));
    portals.set(alice, own);
    return own;
  }

  private resolveWeather(elapsedMs: number): void {
    const { inks } = this.world;
    const { perished } = weather(this.physics.temperature, inks.all, elapsedMs);
    for (const ink of perished) {
      this.events.push({ type: "perished", drawingId: ink.id, nature: ink.nature });
      this.forgetInk(ink.id);
    }
  }

  private feelers(): Feelers {
    return {
      touches: (ink, offset) => this.feltBy(ink, offset),
      groundBelow: (ink, foot, drop) => this.groundBelow(ink, foot, drop),
    };
  }

  private surroundings(): AliceSurroundings {
    const { inks, props } = this.world;
    const feelers = this.feelers();
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
      liftsHer: (body) => {
        const ink = inks.find(body);
        return ink !== undefined && ink.nature === "vehicle" && liftsHer(ink, feelers);
      },
      rideOn: (body) => {
        const ink = inks.find(body);
        return ink === undefined ? null : rideOn(ink);
      },
    };
  }

  private natureWorld(alice: AliceController): NatureWorld {
    const { engine, inks, growthRefusedAt } = this.world;
    return {
      alice,
      alices: this.everyAlice(),
      gravity: accelerationOf(this.physics.gravity),
      intentOf: (each) => this.intentOf(each),
      feelers: this.feelers(),
      emit: (event) => this.events.push(event),
      reachGoal: () => this.reachGoal(alice),
      loseAlice: () => {
        this.world.lost.add(alice);
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
        const bodies = this.everyAlice().map((each) => each.body);
        pullToward(ink.body.position, strengthInG, [...bodies, ...loose]);
      },
      warp: (ink) => {
        const exit = this.portalsOf(alice).through(
          ink,
          inks.all,
          engine.timing.timestamp,
          (event) => this.events.push(event),
        );
        if (exit !== null) alice.warpTo(centreOf(exit));
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
    const { inks, props } = this.world;
    return [
      ...this.bodied().map((alice) => alice.body),
      ...props.solidBodies,
      ...inks.all.filter((other) => other !== ink).map((other) => other.body),
    ];
  }

  private aliceContacts(alice: AliceController): readonly Contact[] {
    const { activePairs } = this.world;
    const pairContacts = activePairs
      .filter(
        ({ collision }) => collision.parentA === alice.body || collision.parentB === alice.body,
      )
      .map(({ collision }) => toContact(alice.body, collision));
    return [...alice.contacts, ...pairContacts];
  }

  private resolveAliceTouches(alice: AliceController): void {
    const { inks, props } = this.world;
    const natureWorld = this.natureWorld(alice);
    const portals = this.portalsOf(alice);
    const barred = portals.barred();
    const touched = new Map<InkEntity, Contact>();
    for (const contact of this.aliceContacts(alice)) {
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
    portals.settle(barred, new Set([...touched.keys()].map((ink) => ink.id)));
  }

  private feedSumikui(elapsedMs: number): void {
    const { sumikui, inks, engine, props } = this.world;
    const now = engine.timing.timestamp;
    if (props.heal(now) > 0) this.events.push({ type: "paper-healed" });
    if (sumikui === null || !this.embodied) return;
    const wasAwake = sumikui.isAwake;
    const alices = this.everyAlice();
    const meal = sumikui.tick(elapsedMs, { alices, inks: inks.all, paper: props.paper });
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
        this.world.lost.add(meal.alice);
        this.events.push({ type: "alice-devoured", who: alices.indexOf(meal.alice) });
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

  private resolveProps(alice: AliceController): void {
    const { props } = this.world;
    const bounds = alice.bounds();
    if (props.keyWithinReach(bounds)) {
      props.keyTaken = true;
      alice.hasKey = true;
      this.events.push({ type: "key-taken" });
    }
    if (props.goalReachedBy(bounds)) this.reachGoal(alice);
  }

  private resolveWhereabouts(): void {
    const { alice, twins, checkpoints, inks, lost, footing } = this.world;
    const alices = this.bodied();
    if (alices.length === 0) return;
    const stood = alice.footingPoint();
    if (stood !== null) footing.stood(stood);
    for (const [who, each] of alices.entries()) {
      if (lost.has(each) || this.isOffTheBoard(each)) {
        const ride = each.snapshot().ride ?? this.rides.get(each);
        const respawn = this.respawnPoint();
        lost.delete(each);
        this.events.push({ type: "fell", who });
        each.placeAt(respawn);
        this.rides.delete(each);
        if (ride?.gait === "vehicle") {
          const vehicle = inks.all.find((ink) => ink.id === ride.id);
          if (vehicle !== undefined) {
            Matter.Body.setAngle(vehicle.body, 0);
            const bounds = exactBounds(vehicle.body);
            Matter.Body.setPosition(vehicle.body, {
              x: vehicle.body.position.x + respawn.x - (bounds.x + bounds.width / 2),
              y: vehicle.body.position.y + respawn.y - bounds.y,
            });
            Matter.Body.setVelocity(vehicle.body, { x: 0, y: 0 });
            Matter.Body.setAngularVelocity(vehicle.body, 0);
          }
        }
      }
    }
    twins.recallStrays(alice);
    const zone = checkpoints.visit(Math.max(...alices.map((each) => each.body.position.x)));
    if (zone !== null) this.events.push({ type: "zone-entered", zoneId: zone.id });
  }

  private reachGoal(alice: AliceController): void {
    const { goalReachedBy } = this.world;
    if (goalReachedBy.has(alice)) return;
    goalReachedBy.add(alice);
    this.events.push({ type: "goal-reached", who: this.everyAlice().indexOf(alice) });
  }

  private isOffTheBoard(alice: AliceController): boolean {
    const { board, inks, props, footing } = this.world;
    const { position } = alice.body;
    if (position.y > board.killY) return true;
    if (board.page === "endless" && footing.fallen(position)) return true;
    const isNear = (rect: Rect): boolean => distanceToRect(position, rect) <= LOST_DISTANCE;
    return !props.solidRects.some(isNear) && !inks.heldBounds.some(isNear);
  }

  private respawnPoint(): Vec {
    const { board, checkpoints, footing, inks } = this.world;
    const marker = inks.spawnMarker;
    if (marker === undefined) {
      return board.page === "endless" ? footing.respawn() : checkpoints.respawn;
    }
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
