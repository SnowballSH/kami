import Matter from "matter-js";
import { arenaHeight } from "../board/boards/arena";
import type { BoardDefinition } from "../board/types";
import type { Ruling } from "../cat/types";
import { distanceToRect, type Rect, type Stroke, type Vec } from "../core/geometry";
import { FIXED_STEP_MS } from "../core/world";
import type { Drawing, DrawingId, InkProvenance } from "../ink/types";
import { validPhysics } from "../rules/effectDomains";
import { EARTH, type WorldPhysics } from "../rules/types";
import { AliceController } from "./alice";
import { pullToward } from "./attraction";
import {
  type BoardWorld,
  buildWorld,
  hasHeadroom,
  isOffTheBoard,
  respawnPoint,
  seatUnder,
  sumikuiFor,
} from "./boardWorld";
import { cutCrosses, incarnate } from "./body/drawnBody";
import type { BodyPartKind, Cut } from "./body/types";
import { exactBounds } from "./bodyBounds";
import type { Prey } from "./boss/snipper";
import { Tear, type TearDeed } from "./boss/tear";
import { SOUL_HOVER_PX, TEAR_TUNING } from "./boss/tuning";
import { blowFrom } from "./boss/weapons";
import {
  GROW_REFUSAL_COOLDOWN_MS,
  MIN_TIME_SCALE,
  SUMIKUI_BITE_DEPTH,
  SUMIKUI_BITE_WIDTH,
} from "./constants";
import { type Contact, contactsAt, contactsWith, toContact } from "./contacts";
import type { Feelers } from "./creatures";
import { EMPTY_BOARD } from "./emptyBoard";
import { bounceArcUnder, jumpArcUnder, walkSpeedAt } from "./flight";
import type { InkEntity } from "./inkEntity";
import { moveOfItself } from "./motion";
import { NATURES, type NatureWorld, stepOf } from "./natures";
import { seesHerWay } from "./nightfall";
import { isLooseInk } from "./paper";
import { Portals } from "./portals";
import { restingFeet } from "./restingFeet";
import { LiveSurroundings } from "./surroundings";
import {
  ALICE_HERSELF,
  type AliceIndex,
  type AliceSnapshot,
  type BounceArc,
  type Ride,
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

/** Every Alice on the board, Alice herself first, then her twins in order. */
type Roster = readonly [AliceController, ...AliceController[]];

export class MatterSimulation implements Simulation {
  private physics: WorldPhysics = EARTH;
  private world: BoardWorld = buildWorld(EMPTY_BOARD, EARTH);
  private intents: WalkIntent[] = [];
  private readonly rides = new Map<AliceController, Ride>();
  private roster: Roster | null = null;
  private bulletTime = 1;
  private events: SimEvent[] = [];
  /** False until the first step after a board opens: laws folded before then were born with the room. */
  private underway = false;
  /** Everything a creature's feelers might touch this tick, built once and reused across probes. */
  private tickBodies: readonly Matter.Body[] = [];
  private readonly natureWorlds = new Map<AliceController, NatureWorld>();
  private readonly feelers: Feelers = {
    touches: (ink, offset) => contactsAt(ink.body, offset, this.tickBodies, ink.body),
    groundBelow: (ink, foot, drop) => {
      const probe = Matter.Bodies.rectangle(foot.x, foot.y + drop / 2, 2, drop);
      return contactsWith(probe, this.tickBodies, ink.body).length > 0;
    },
  };
  private surroundings = new LiveSurroundings(this.world, this.feelers);

  loadBoard(board: BoardDefinition): void {
    Matter.Engine.clear(this.world.engine);
    this.world = buildWorld(board, this.physics);
    this.surroundings = new LiveSurroundings(this.world, this.feelers);
    this.rosterChanged();
    this.events = [];
    this.rides.clear();
    this.underway = false;
  }

  setPhysics(physics: WorldPhysics): void {
    if (!validPhysics(physics)) throw new RangeError("Invalid world physics");
    const { alice, twins, inks, paper } = this.world;
    this.physics = physics;
    paper.obey(physics);
    alice.applyPhysics(physics);
    twins.match(this.embodied ? physics.clones : 0, alice, physics);
    this.rosterChanged();
    inks.setPhysics(physics);
    this.matchSumikui(physics.inkEater, { bides: !this.underway });
  }

  private matchSumikui(inkEater: number, { bides }: { readonly bides: boolean }): void {
    if (inkEater <= 0) this.world.sumikui = null;
    else this.world.sumikui ??= sumikuiFor(this.world, bides);
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
    const { alice, engine, board } = this.world;
    const heart = alice.heart();
    const seat = this.world.soul ?? { x: heart.x, y: heart.y - SOUL_HOVER_PX };
    Matter.Composite.remove(engine.world, alice.body);
    const soul = new AliceController(board.spawn, this.physics);
    soul.placeAt({ x: seat.x, y: seat.y + soul.bounds().height / 2 });
    this.world.soul = seat;
    this.takeOver(soul, 0);
  }

  incarnate(id: DrawingId, name: string, strokes?: readonly Stroke[]): boolean {
    const { inks, engine, alice, props } = this.world;
    const ink = inks.all.find((each) => each.id === id);
    if (ink === undefined) return false;
    const seat = this.world.soul ?? alice.heart();
    const born = incarnate(strokes ?? ink.worldStrokes, seat, name, engine.timing.timestamp);
    this.forgetInk(id);
    Matter.Composite.remove(engine.world, alice.body);
    const { width, height } = born.body.frame;
    const bornFrame = {
      x: born.centre.x - width / 2,
      y: born.centre.y - height / 2,
      width,
      height,
    };
    const feet = restingFeet(bornFrame, [
      ...props.solidRects,
      ...inks.all
        .filter((each) => NATURES[each.nature].solidToAlice)
        .map((each) => exactBounds(each.body)),
    ]);
    const embodied = new AliceController(
      { x: born.centre.x, y: feet },
      this.physics,
      born.body.frame,
    );
    embodied.wear(born.body, name);
    Matter.Composite.add(engine.world, embodied.body);
    this.world.soul = null;
    this.takeOver(embodied, this.physics.clones);
    return true;
  }

  /** `alice` becomes the one the player is, with `clones` twins beside her and a Sumikui that has yet to notice her. */
  private takeOver(alice: AliceController, clones: number): void {
    this.world.alice = alice;
    this.world.twins.match(clones, alice, this.physics);
    this.rosterChanged();
    this.world.sumikui = null;
    this.matchSumikui(this.physics.inkEater, { bides: true });
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
    const top = this.world.board.page === "arena" ? -arenaHeight(this.world.board) : -Infinity;
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
    return this.world.paper.angle;
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

  /**
   * The key is the party's once taken: whoever of them reaches the door opens it. Someone is always
   * seen holding it, so when its holder leaves (a twin dismissed, a body shed) Alice takes it.
   */
  private rosterChanged(): void {
    this.roster = null;
    this.world.footings.keep(this.everyAlice().length);
    const { props, alice } = this.world;
    if (props.keyTaken && !this.everyAlice().some((each) => each.hasKey)) alice.hasKey = true;
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
    const { engine, inks, props, activePairs, paper } = this.world;
    const alices = this.bodied();
    const elapsedMs = FIXED_STEP_MS * timeScale;
    activePairs.length = 0;
    this.natureWorlds.clear();
    engine.gravity.x = this.physics.gravity.x;
    engine.gravity.y = this.physics.gravity.y;
    engine.timing.timeScale = timeScale;

    this.growLawfully();
    this.tickBodies = [
      ...alices.map((each) => each.body),
      ...props.solidBodies,
      ...inks.all.map((ink) => ink.body),
    ];
    const { surroundings } = this;
    for (const alice of alices) {
      if (alice.riding !== null) this.rides.set(alice, alice.riding);
      else if (alice.grounded) this.rides.delete(alice);
    }
    for (const alice of alices) {
      alice.control(this.intentSheCanFollow(alice), surroundings, timeScale);
    }
    this.stepInks();
    moveOfItself(inks.all, timeScale);
    this.blowWind();
    this.tumbleLooseInk();
    for (const alice of alices) {
      pullToward(alice.body.position, this.physics.attraction, inks.dynamicBodies);
    }
    Matter.Engine.update(engine, FIXED_STEP_MS);
    paper.advance(this.physics, elapsedMs);
    for (const alice of alices) {
      alice.advanceResize(elapsedMs);
      alice.sense(surroundings, this.intentSheCanFollow(alice));
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
    if (snipped === null || (!snipped.heartCut && snipped.removed.length === 0)) {
      this.events.push({ type: "snip-missed" });
      return;
    }
    tear.landed(cut);
    if (snipped.heartCut) {
      this.disembody();
      this.world.tear = null;
      this.events.push({ type: "heart-swallowed" });
      return;
    }
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

  /** Each drawing's own doings this tick, on behalf of whichever Alice is nearest it. */
  private stepInks(): void {
    let standing: readonly { readonly alice: AliceController; readonly bounds: Rect }[] | null =
      null;
    for (const ink of this.world.inks.all) {
      const step = stepOf(ink);
      if (step === undefined) continue;
      standing ??= this.everyAlice().map((alice) => ({ alice, bounds: alice.bounds() }));
      let nearest = this.world.alice;
      let gap = Number.POSITIVE_INFINITY;
      for (const { alice, bounds } of standing) {
        const d = distanceToRect(ink.body.position, bounds);
        if (d < gap) {
          gap = d;
          nearest = alice;
        }
      }
      step(ink, this.natureWorld(nearest));
    }
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
    for (const alice of this.bodied()) push(alice.body, wind);
    for (const body of this.world.inks.dynamicBodies) push(body, wind);
  }

  private tumbleLooseInk(): void {
    this.world.paper.tumble(this.physics.gravity, this.looseBodies());
  }

  private *looseBodies(): Generator<Matter.Body> {
    for (const ink of this.world.inks.all) {
      if (!ink.body.isStatic && isLooseInk(ink.nature)) yield ink.body;
    }
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
    const { perished } = weather(this.physics.temperature, this.world.inks.all, elapsedMs);
    for (const ink of perished) {
      this.events.push({ type: "perished", drawingId: ink.id, nature: ink.nature });
      this.forgetInk(ink.id);
    }
  }

  /** The board as the natures see it on behalf of `alice`; one per Alice per tick. */
  private natureWorld(alice: AliceController): NatureWorld {
    const known = this.natureWorlds.get(alice);
    if (known !== undefined) return known;
    const made = this.makeNatureWorld(alice);
    this.natureWorlds.set(alice, made);
    return made;
  }

  private makeNatureWorld(alice: AliceController): NatureWorld {
    const { engine, inks, growthRefusedAt } = this.world;
    return {
      alice,
      alices: this.everyAlice(),
      gravity: accelerationOf(this.physics.gravity),
      temperature: this.physics.temperature,
      intentOf: (each) => this.intentOf(each),
      feelers: this.feelers,
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
      hasHeadroomFor: (size, meal) => hasHeadroom(this.world, alice, alice.scaleFor(size), meal),
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
        if (exit !== null) alice.warpTo(exit.centre);
      },
    };
  }

  private aliceContacts(alice: AliceController): readonly Contact[] {
    const pairContacts = this.world.activePairs
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
      if (props.isDoor(contact.body) && props.keyTaken) {
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
    const touch = (body: Matter.Body, surface: Matter.Body): void => {
      const ink = inks.find(body);
      if (ink !== undefined && holdsInk(surface)) {
        NATURES[ink.nature].onSurfaceTouch?.(ink, natureWorld);
      }
    };
    for (const { collision } of activePairs) {
      touch(collision.parentA, collision.parentB);
      touch(collision.parentB, collision.parentA);
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
    const { alice, twins, checkpoints, inks, lost, footings } = this.world;
    const alices = this.bodied();
    if (alices.length === 0) return;
    for (const [who, each] of alices.entries()) {
      const footing = footings.of(who);
      const stood = each.footingPoint();
      if (stood !== null) footing.stood(stood);
      if (!lost.has(each) && !isOffTheBoard(this.world, each.body.position, footing)) continue;
      const ride = each.riding ?? this.rides.get(each);
      const respawn = respawnPoint(this.world, footing);
      lost.delete(each);
      this.events.push({ type: "fell", who });
      each.placeAt(respawn);
      this.rides.delete(each);
      const vehicle =
        ride?.gait === "vehicle" ? inks.all.find((ink) => ink.id === ride.id) : undefined;
      if (vehicle !== undefined) seatUnder(vehicle, respawn);
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

  /** Grants each Alice the size the laws ask for; growing waits until nothing is overhead. */
  private growLawfully(): void {
    for (const each of this.everyAlice()) {
      const wanted = each.lawfulScale;
      if (wanted === each.headingScale) continue;
      if (wanted < each.headingScale || hasHeadroom(this.world, each, wanted))
        each.beginResize(each.size);
    }
  }
}
