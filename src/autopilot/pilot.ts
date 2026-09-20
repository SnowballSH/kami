import { distance, type Vec } from "../core/geometry";
import type { DrawingId } from "../ink/types";
import type { AliceSize, Axis, WalkIntent } from "../sim/types";
import { Chart } from "./chart";
import { afterTheMeal, chewedIn, dreadIn, SAFE_PX } from "./dread";
import {
  type Footprint,
  feetOf,
  footprintFor,
  type Node,
  nodeOfFeet,
  Pathfinder,
  type Waypoint,
} from "./pathfinder";
import type {
  Autopilot,
  Errand,
  Objective,
  PilotOptions,
  PilotStatus,
  Scene,
  SceneInk,
} from "./types";

const IDLE: WalkIntent = { x: 0, y: 0 };
/** She re-reads the board this often even when nothing told her it changed. */
/**
 * A re-plan reads the whole board (tens of ms on a tablet). On her way it is worth doing twice a
 * second, because ink moves under her. While she waits, nothing she does can change the answer —
 * `invalidate()` already reports every new stroke, name and rule — so she only glances again every
 * two seconds, for ink that is still settling.
 */
const REPLAN_TICKS = 30;
const WAITING_REPLAN_TICKS = 120;
/** Running from the Sumikui, which moves, she checks her escape more often — three times a second, not more: each look costs a fifth of a frame on a tablet. */
const FLEEING_REPLAN_TICKS = 20;
/** Ticks on the ground without the way ahead getting any shorter before she gives up and waits. */
const STALL_TICKS = 240;
/** Ticks she sulks after a stall before trying the board again on her own. */
const SULK_TICKS = 180;
const LOOKAHEAD_NODES = 6;
const OFF_PATH_PX = 28;
const REACHED_PX = 12;
const DEADBAND_PX = 2;
/** How far short of the edge she waits, in body widths, so the player can draw right up to it. */
const STANDOFF_BODIES = 6;
/** Ticks without moving after which "in the air" is really "wedged", and she thinks again. */
const SETTLE_TICKS = 20;
const SETTLE_PX = 0.5;
/** How far ahead a wandering Alice sets her sights, and how long she looks about at the end. */
const WANDER_PX = 480;
const WANDER_REST_TICKS = 90;

const ALONE: PilotOptions = { seed: 0, wanders: false, charter: Chart.of };

const RESTING: PilotStatus = { errand: { kind: "idle" }, stuck: false, target: null };

const feetOfScene = (scene: Scene): Vec => ({
  x: scene.alice.center.x,
  y: scene.alice.center.y + scene.alice.height / 2,
});

const goalInks = (scene: Scene): readonly SceneInk[] =>
  scene.inks.filter((ink) => ink.nature === "goal");

const objectiveOf = (scene: Scene): Objective | null => {
  const { board } = scene;
  if (board.key !== undefined && !scene.keyTaken) return "key";
  if (board.door !== undefined && !scene.doorOpen) return "door";
  if (board.goal !== undefined || goalInks(scene).length > 0) return "goal";
  return null;
};

const pointOf = (scene: Scene, objective: Objective): Vec => {
  const { key, door, goal } = scene.board;
  const feet = feetOfScene(scene);
  if (objective === "key" && key !== undefined) return key;
  if (objective === "door" && door !== undefined) {
    return { x: door.x + door.width / 2, y: door.y + door.height };
  }
  if (goal !== undefined) return { x: goal.x + goal.width / 2, y: goal.y + goal.height };
  const nearest = goalInks(scene)
    .map((ink) => ink.pose.position)
    .sort((a, b) => distance(a, feet) - distance(b, feet))[0];
  return nearest ?? feet;
};

/** Trim the tail of a level walk so she stops short of wherever it ends. */
const standBack = (
  path: readonly Waypoint[] | null,
  footprint: Footprint,
): readonly Waypoint[] | null => {
  if (path === null) return null;
  let end = path.length;
  const cells = Math.round(footprint.cols * STANDOFF_BODIES);
  for (let trimmed = 0; trimmed < cells && end > 1; trimmed++) {
    const last = path[end - 1];
    const before = path[end - 2];
    if (last === undefined || before === undefined) break;
    if (last.via !== "walk" || last.node.r0 !== before.node.r0) break;
    end--;
  }
  return path.slice(0, end);
};

const sizeAfterEating = (ink: SceneInk): AliceSize | null =>
  ink.nature === "grow" ? "big" : ink.nature === "shrink" ? "small" : null;

const sameNode = (a: Node | undefined, b: Node | undefined): boolean =>
  a !== undefined && b !== undefined && a.c0 === b.c0 && a.r0 === b.r0;

const sign = (value: number): Axis => (value > 0 ? 1 : value < 0 ? -1 : 0);

const isAirborne = (scene: Scene): boolean => !scene.alice.grounded && !scene.alice.climbing;

const sameErrand = (a: Errand, b: Errand): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === "eat") return b.kind === "eat" && a.drawingId === b.drawingId;
  if (a.kind === "wander") return b.kind === "wander" && a.heading === b.heading;
  if (a.kind === "objective" || a.kind === "wait") {
    return "objective" in b && a.objective === b.objective;
  }
  return true;
};

interface Plan {
  readonly errand: Errand;
  readonly path: readonly Waypoint[] | null;
  readonly footprint: Footprint;
  readonly size: AliceSize;
  readonly sizeMultiplier: number;
  readonly keyTaken: boolean;
  readonly doorOpen: boolean;
  readonly dread: boolean;
  /** Fleeing with no footing out of the Sumikui's reach: she runs anyway, and looks to the player. */
  readonly cornered: boolean;
  readonly chewing: DrawingId | null;
}

/** Alice's mind: reads the board as a grid, walks the cheapest way to what matters, and waits when there is none. */
export class Pilot implements Autopilot {
  private plan: Plan | null = null;
  private stale = true;
  private ticksSincePlan = 0;
  private reached = 0;
  private bestRemaining = Number.POSITIVE_INFINITY;
  private ticksSinceProgress = 0;
  private sulkTicks = 0;
  private lastFeet: Vec | null = null;
  private stillTicks = 0;
  private heading: -1 | 1;
  private restTicks = 0;
  private current: PilotStatus = RESTING;

  constructor(private readonly options: PilotOptions = ALONE) {
    this.heading = options.seed % 2 === 0 ? 1 : -1;
  }

  get status(): PilotStatus {
    return this.current;
  }

  reset(): void {
    this.plan = null;
    this.stale = true;
    this.sulkTicks = 0;
    this.lastFeet = null;
    this.current = RESTING;
  }

  invalidate(): void {
    this.stale = true;
    this.sulkTicks = 0;
  }

  drive(scene: Scene): WalkIntent {
    if (this.sulkTicks > 0) {
      this.sulkTicks--;
      if (this.sulkTicks === 0) this.stale = true;
      return IDLE;
    }
    this.ticksSincePlan++;
    const airborne = this.inFlight(scene);
    const due = !airborne && this.ticksSincePlan >= this.replanInterval();
    if (this.stale || due || this.sceneChanged(scene)) this.replan(scene);
    return this.steer(scene, airborne);
  }

  private inFlight(scene: Scene): boolean {
    const feet = feetOfScene(scene);
    const moved = this.lastFeet === null || distance(feet, this.lastFeet) > SETTLE_PX;
    this.stillTicks = moved ? 0 : this.stillTicks + 1;
    this.lastFeet = feet;
    return isAirborne(scene) && this.stillTicks < SETTLE_TICKS;
  }

  private sceneChanged(scene: Scene): boolean {
    const plan = this.plan;
    const footprint = footprintFor(scene.alice);
    return (
      plan === null ||
      plan.size !== scene.alice.size ||
      plan.sizeMultiplier !== scene.alice.sizeMultiplier ||
      plan.footprint.cols !== footprint.cols ||
      plan.footprint.rows !== footprint.rows ||
      plan.keyTaken !== scene.keyTaken ||
      plan.doorOpen !== scene.doorOpen ||
      plan.dread !== (dreadIn(scene) !== null) ||
      plan.chewing !== chewedIn(scene)
    );
  }

  private replanInterval(): number {
    const errand = this.plan?.errand.kind;
    if (errand === "flee") return FLEEING_REPLAN_TICKS;
    return errand === "wait" || errand === "idle" ? WAITING_REPLAN_TICKS : REPLAN_TICKS;
  }

  private replan(scene: Scene): void {
    const objective = objectiveOf(scene);
    const footprint = footprintFor(scene.alice);
    const previous = this.plan;
    const threat = dreadIn(scene);
    const plan =
      threat !== null
        ? this.fleePlan(scene, footprint, threat)
        : objective === null
          ? this.strollOrIdle(scene, footprint)
          : this.planFor(scene, footprint, objective);

    const last = plan.path?.at(-1);
    const freshStart =
      this.stale ||
      previous === null ||
      !sameErrand(previous.errand, plan.errand) ||
      !sameNode(previous.path?.at(-1)?.node, last?.node);
    this.plan = plan;
    this.stale = false;
    this.ticksSincePlan = 0;
    this.reached = 0;
    if (freshStart) {
      this.bestRemaining = Number.POSITIVE_INFINITY;
      this.ticksSinceProgress = 0;
    }
    this.current = {
      errand: plan.errand,
      stuck: plan.cornered || (plan.errand.kind === "wait" && (plan.path?.length ?? 0) <= 1),
      target: last === undefined ? null : feetOf(last.node, footprint),
    };
  }

  private strollOrIdle(scene: Scene, footprint: Footprint): Plan {
    const idle = this.remember(scene, footprint, { kind: "idle" }, null);
    if (!this.options.wanders) return idle;
    const chart = this.options.charter(scene);
    if (chart === null) return idle;
    const finder = new Pathfinder(chart, scene, footprint);
    const feet = feetOfScene(scene);
    const ahead = { x: feet.x + this.heading * WANDER_PX, y: feet.y };
    const route = finder.nearestTo(nodeOfFeet(feet, footprint), ahead);
    if (route === null) return idle;
    return this.remember(scene, footprint, { kind: "wander", heading: this.heading }, route);
  }

  /**
   * Routes are drawn on the board as it will be once the Sumikui finishes its mouthful, so she
   * never sets out over a dissolving bridge; already on one, she races across while it stands.
   */
  private planFor(scene: Scene, footprint: Footprint, objective: Objective): Plan {
    const foreseen = afterTheMeal(scene);
    const chart = this.options.charter(foreseen);
    if (chart === null) return this.remember(scene, footprint, { kind: "wait", objective }, null);
    const finder = new Pathfinder(chart, foreseen, footprint);
    const start = nodeOfFeet(feetOfScene(scene), footprint);
    const direct =
      finder.route(start, { kind: "objective", objective }) ??
      (finder.isSupported(start) ? null : this.dash(scene, foreseen, footprint, start, objective));
    if (direct !== null) {
      return this.remember(scene, footprint, { kind: "objective", objective }, direct);
    }
    return (
      this.mealPlan(foreseen, finder, start, footprint, objective) ??
      this.remember(
        scene,
        footprint,
        { kind: "wait", objective },
        standBack(finder.nearestTo(start, pointOf(scene, objective)), footprint),
      )
    );
  }

  private dash(
    scene: Scene,
    foreseen: Scene,
    footprint: Footprint,
    start: Node,
    objective: Objective,
  ): readonly Waypoint[] | null {
    if (foreseen === scene) return null;
    const chart = this.options.charter(scene);
    if (chart === null) return null;
    return new Pathfinder(chart, scene, footprint).route(start, { kind: "objective", objective });
  }

  private fleePlan(scene: Scene, footprint: Footprint, threat: Vec): Plan {
    const foreseen = afterTheMeal(scene);
    const chart = this.options.charter(foreseen);
    if (chart === null) return this.remember(scene, footprint, { kind: "flee" }, null);
    const finder = new Pathfinder(chart, foreseen, footprint);
    const start = nodeOfFeet(feetOfScene(scene), footprint);
    const flight = finder.awayFrom(start, threat, SAFE_PX);
    return {
      ...this.remember(scene, footprint, { kind: "flee" }, flight?.path ?? null),
      cornered: flight === null || !flight.safe,
    };
  }

  private mealPlan(
    scene: Scene,
    finder: Pathfinder,
    start: Node,
    footprint: Footprint,
    objective: Objective,
  ): Plan | null {
    const feet = feetOfScene(scene);
    const meals = scene.inks
      .filter((ink) => sizeAfterEating(ink) !== null && sizeAfterEating(ink) !== scene.alice.size)
      .sort((a, b) => distance(a.pose.position, feet) - distance(b.pose.position, feet));
    for (const meal of meals) {
      const route = finder.route(start, { kind: "eat", drawingId: meal.drawing.id });
      const last = route?.at(-1);
      const newSize = sizeAfterEating(meal);
      if (route === null || last === undefined || newSize === null) continue;
      const after: Scene = {
        ...scene,
        inks: scene.inks.filter((ink) => ink.drawing.id !== meal.drawing.id),
      };
      const grown = footprintFor(scene.alice, newSize);
      const chart = this.options.charter(after);
      if (chart === null) continue;
      const onward = new Pathfinder(chart, after, grown);
      const from = nodeOfFeet(feetOf(last.node, footprint), grown);
      if (onward.route(from, { kind: "objective", objective }) === null) continue;
      return this.remember(scene, footprint, { kind: "eat", drawingId: meal.drawing.id }, route);
    }
    return null;
  }

  private remember(
    scene: Scene,
    footprint: Footprint,
    errand: Errand,
    path: readonly Waypoint[] | null,
  ): Plan {
    return {
      errand,
      path,
      footprint,
      size: scene.alice.size,
      sizeMultiplier: scene.alice.sizeMultiplier,
      keyTaken: scene.keyTaken,
      doorOpen: scene.doorOpen,
      dread: dreadIn(scene) !== null,
      cornered: false,
      chewing: chewedIn(scene),
    };
  }

  private steer(scene: Scene, airborne: boolean): WalkIntent {
    const plan = this.plan;
    if (plan === null || plan.path === null) return IDLE;
    const { path, footprint } = plan;
    const feet = feetOfScene(scene);

    if (airborne) this.advanceInFlight(path, footprint, feet);
    else this.advanceOnFoot(path, footprint, feet);
    if (this.stalled(path, airborne || plan.errand.kind === "flee")) return IDLE;

    const here = path[this.reached];
    const next = path[this.reached + 1];
    if (here === undefined || next === undefined) {
      if (plan.errand.kind === "wait" && !this.current.stuck) {
        this.current = { ...this.current, stuck: true };
      }
      return this.nudge(scene, plan.errand);
    }

    if (next.via === "jump" && !airborne) return this.takeOff(here, next, footprint, feet);
    if (next.via === "warp" && next.through !== undefined) {
      return { x: sign(next.through.x - feet.x), y: 0 };
    }
    const aim = airborne ? next : (path[this.lookahead(path)] ?? next);
    const dx = feetOf(aim.node, footprint).x - feet.x;
    const stepping = aim.via === "walk" && (airborne || aim.node.r0 < here.node.r0);
    return {
      x: Math.abs(dx) > DEADBAND_PX ? sign(dx) : stepping ? sign(aim.node.c0 - here.node.c0) : 0,
      y: next.via === "climb" && !airborne ? sign(next.node.r0 - here.node.r0) : 0,
    };
  }

  /** Line up under the jump first, then press up while already leaning towards the landing. */
  private takeOff(here: Waypoint, next: Waypoint, footprint: Footprint, feet: Vec): WalkIntent {
    const dxHere = feetOf(here.node, footprint).x - feet.x;
    if (Math.abs(dxHere) > REACHED_PX) return { x: sign(dxHere), y: 0 };
    return { x: sign(feetOf(next.node, footprint).x - feet.x), y: -1 };
  }

  /** On the ground she may skip ahead or drift back a little; far off the path she rethinks it. */
  private advanceOnFoot(path: readonly Waypoint[], footprint: Footprint, feet: Vec): void {
    let nearest = this.reached;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = Math.max(0, this.reached - 1); index < path.length; index++) {
      const waypoint = path[index];
      if (waypoint === undefined) continue;
      const d = distance(feetOf(waypoint.node, footprint), feet);
      if (d < nearestDistance) {
        nearestDistance = d;
        nearest = index;
      }
    }
    if (nearestDistance > OFF_PATH_PX) this.stale = true;
    this.reached = Math.max(this.reached, nearest);
  }

  /** In the air she only counts the waypoint she is flying towards, once she is on it. */
  private advanceInFlight(path: readonly Waypoint[], footprint: Footprint, feet: Vec): void {
    const next = path[this.reached + 1];
    if (next !== undefined && distance(feetOf(next.node, footprint), feet) <= REACHED_PX) {
      this.reached++;
    }
  }

  /** `patient` while airborne or fleeing: neither is a time to conclude the board has beaten her. */
  private stalled(path: readonly Waypoint[], patient: boolean): boolean {
    const remaining = path.length - 1 - this.reached;
    if (remaining <= 0) return false;
    if (remaining < this.bestRemaining) {
      this.bestRemaining = remaining;
      this.ticksSinceProgress = 0;
      return false;
    }
    if (patient || ++this.ticksSinceProgress < STALL_TICKS) return false;
    if (this.plan?.errand.kind === "wander") this.turnBack();
    else this.giveUp();
    return true;
  }

  /** How far along a run of plain steps she can look, so she strides instead of tiptoeing cell to cell. */
  private lookahead(path: readonly Waypoint[]): number {
    let aim = this.reached + 1;
    while (aim + 1 < path.length && aim - this.reached < LOOKAHEAD_NODES) {
      const a = path[aim];
      const b = path[aim + 1];
      if (a === undefined || b === undefined || b.via !== "walk" || b.node.r0 !== a.node.r0) break;
      aim++;
    }
    return aim;
  }

  /** At the last node: keep leaning into whatever she came for, so touching it registers. */
  private nudge(scene: Scene, errand: Errand): WalkIntent {
    const towards = (x: number): WalkIntent => ({ x: sign(x - scene.alice.center.x), y: 0 });
    if (errand.kind === "wait" || errand.kind === "idle" || errand.kind === "flee") return IDLE;
    if (errand.kind === "wander") {
      this.lookAbout();
      return IDLE;
    }
    if (errand.kind === "eat") {
      const meal = scene.inks.find((ink) => ink.drawing.id === errand.drawingId);
      return meal === undefined ? IDLE : towards(meal.pose.position.x);
    }
    return towards(pointOf(scene, errand.objective).x);
  }

  /** At the end of a stroll she stands a while, then turns and strolls back the other way. */
  private lookAbout(): void {
    if (++this.restTicks < WANDER_REST_TICKS) return;
    this.turnBack();
  }

  private turnBack(): void {
    this.restTicks = 0;
    this.ticksSinceProgress = 0;
    this.heading = this.heading === 1 ? -1 : 1;
    this.stale = true;
  }

  private giveUp(): void {
    this.sulkTicks = SULK_TICKS;
    this.ticksSinceProgress = 0;
    this.current = { ...this.current, stuck: true, target: null };
  }
}

export const createAutopilot = (options?: PilotOptions): Autopilot => new Pilot(options);
