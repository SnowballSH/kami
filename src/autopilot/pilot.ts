import type { Vec } from "../core/geometry";
import type { AliceSize, Axis, WalkIntent } from "../sim/types";
import { Chart } from "./chart";
import {
  type Footprint,
  feetOf,
  footprintFor,
  type Node,
  nodeOfFeet,
  Pathfinder,
  type Waypoint,
} from "./pathfinder";
import type { Autopilot, Errand, Objective, PilotStatus, Scene, SceneInk } from "./types";

const IDLE: WalkIntent = { x: 0, y: 0 };
/** She re-reads the page this often even when nothing told her it changed. */
const REPLAN_TICKS = 15;
/** Ticks on the ground without the way ahead getting any shorter before she gives up and waits. */
const STALL_TICKS = 240;
/** Ticks she sulks after a stall before trying the page again on her own. */
const SULK_TICKS = 180;
const LOOKAHEAD_NODES = 6;
const OFF_PATH_PX = 28;
const REACHED_PX = 12;
const DEADBAND_PX = 2;
/** How far short of the edge she waits, in body widths, so the player can draw right up to it. */
const STANDOFF_BODIES = 4;

const feetOfScene = (scene: Scene): Vec => ({
  x: scene.alice.center.x,
  y: scene.alice.center.y + scene.alice.height / 2,
});

const objectiveOf = (scene: Scene): Objective => {
  const { level } = scene;
  if (level.key !== undefined && !scene.keyTaken) return "key";
  if (level.door !== undefined && !scene.doorOpen) return "door";
  return "exit";
};

const pointOf = (scene: Scene, objective: Objective): Vec => {
  const { key, door, exit } = scene.level;
  if (objective === "key" && key !== undefined) return key;
  if (objective === "door" && door !== undefined) {
    return { x: door.x + door.width / 2, y: door.y + door.height };
  }
  return { x: exit.x + exit.width / 2, y: exit.y + exit.height };
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

const sign = (value: number): Axis => (value > 0 ? 1 : value < 0 ? -1 : 0);

const isAirborne = (scene: Scene): boolean => !scene.alice.grounded && !scene.alice.climbing;

const distance = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
/** Ticks without moving after which "in the air" is really "wedged", and she thinks again. */
const SETTLE_TICKS = 20;
const SETTLE_PX = 0.5;

interface Plan {
  readonly errand: Errand;
  readonly path: readonly Waypoint[] | null;
  readonly footprint: Footprint;
  readonly size: AliceSize;
  readonly keyTaken: boolean;
  readonly doorOpen: boolean;
}

/** Alice's mind: reads the page as a grid, walks the cheapest way to what matters, and waits when there is none. */
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
  private current: PilotStatus = {
    errand: { kind: "wait", objective: "exit" },
    stuck: false,
    target: null,
  };

  get status(): PilotStatus {
    return this.current;
  }

  reset(): void {
    this.plan = null;
    this.stale = true;
    this.sulkTicks = 0;
    this.current = { errand: { kind: "wait", objective: "exit" }, stuck: false, target: null };
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
    const due = !airborne && this.ticksSincePlan >= REPLAN_TICKS;
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
    return (
      plan === null ||
      plan.size !== scene.alice.size ||
      plan.keyTaken !== scene.keyTaken ||
      plan.doorOpen !== scene.doorOpen
    );
  }

  private replan(scene: Scene): void {
    const objective = objectiveOf(scene);
    const footprint = footprintFor(scene.alice.size);
    const chart = Chart.of(scene);
    const finder = new Pathfinder(chart, scene, footprint);
    const start = nodeOfFeet(feetOfScene(scene), footprint);
    const previous = this.plan;

    const direct = finder.route(start, { kind: "objective", objective });
    const plan: Plan =
      direct !== null
        ? this.remember(scene, footprint, { kind: "objective", objective }, direct)
        : (this.mealPlan(scene, finder, start, footprint, objective) ??
          this.remember(
            scene,
            footprint,
            { kind: "wait", objective },
            standBack(finder.nearestTo(start, pointOf(scene, objective)), footprint),
          ));

    this.plan = plan;
    this.stale = false;
    this.ticksSincePlan = 0;
    this.reached = 0;
    if (previous === null || !sameErrand(previous.errand, plan.errand) || previous.path === null) {
      this.bestRemaining = Number.POSITIVE_INFINITY;
      this.ticksSinceProgress = 0;
    }
    const last = plan.path?.at(-1);
    this.current = {
      errand: plan.errand,
      stuck: plan.errand.kind === "wait" && (plan.path?.length ?? 0) <= 1,
      target: last === undefined ? null : feetOf(last.node, footprint),
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
      const grown = footprintFor(newSize);
      const onward = new Pathfinder(Chart.of(after), after, grown);
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
      keyTaken: scene.keyTaken,
      doorOpen: scene.doorOpen,
    };
  }

  private steer(scene: Scene, airborne: boolean): WalkIntent {
    const plan = this.plan;
    if (plan === null || plan.path === null) return IDLE;
    const { path, footprint } = plan;
    const feet = feetOfScene(scene);

    if (airborne) this.advanceInFlight(path, footprint, feet);
    else this.advanceOnFoot(path, footprint, feet);
    if (this.stalled(path, airborne)) return IDLE;

    const here = path[this.reached];
    const next = path[this.reached + 1];
    if (here === undefined || next === undefined) {
      if (plan.errand.kind === "wait" && !this.current.stuck)
        this.current = { ...this.current, stuck: true };
      return this.nudge(scene, plan.errand);
    }

    const aim = airborne ? next : (path[this.lookahead(path)] ?? next);
    const dx = feetOf(aim.node, footprint).x - feet.x;
    const stepping = aim.via === "walk" && (airborne || aim.node.r0 < here.node.r0);
    return {
      x: Math.abs(dx) > DEADBAND_PX ? sign(dx) : stepping ? sign(aim.node.c0 - here.node.c0) : 0,
      y: next.via === "climb" && !airborne ? sign(next.node.r0 - here.node.r0) : 0,
    };
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

  private stalled(path: readonly Waypoint[], airborne: boolean): boolean {
    const remaining = path.length - 1 - this.reached;
    if (remaining < this.bestRemaining) {
      this.bestRemaining = remaining;
      this.ticksSinceProgress = 0;
      return false;
    }
    if (airborne || ++this.ticksSinceProgress < STALL_TICKS) return false;
    this.giveUp();
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
    const { level } = scene;
    if (errand.kind === "wait") return IDLE;
    if (errand.kind === "eat") {
      const meal = scene.inks.find((ink) => ink.drawing.id === errand.drawingId);
      return meal === undefined ? IDLE : towards(meal.pose.position.x);
    }
    switch (errand.objective) {
      case "key":
        return level.key === undefined ? IDLE : towards(level.key.x);
      case "door":
        return level.door === undefined ? IDLE : towards(level.door.x + level.door.width / 2);
      case "exit":
        return towards(level.exit.x + level.exit.width / 2);
    }
  }

  private giveUp(): void {
    this.sulkTicks = SULK_TICKS;
    this.ticksSinceProgress = 0;
    this.current = { ...this.current, stuck: true, target: null };
  }
}

const sameErrand = (a: Errand, b: Errand): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === "eat" && b.kind === "eat") return a.drawingId === b.drawingId;
  if (a.kind !== "eat" && b.kind !== "eat") return a.objective === b.objective;
  return false;
};

export const createAutopilot = (): Autopilot => new Pilot();
