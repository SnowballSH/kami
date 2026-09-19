import { distanceToRect, expandRect, type Rect, rectsOverlap, type Vec } from "../core/geometry";
import type { DrawingId } from "../ink/types";
import { ALICE_BASE, ALICE_SCALE, type AliceSize, type BounceArc, KEY_PICKUP } from "../sim/types";
import { CELL_PX, CellFlag, type CellRange, type Chart } from "./chart";
import type { Objective, Scene } from "./types";

/** Where her feet are on the grid: body spans columns [c0, c0 + cols) and rows [r0 - rows, r0). */
export interface Node {
  readonly c0: number;
  readonly r0: number;
}

export interface Footprint {
  readonly cols: number;
  readonly rows: number;
}

export type Move = "walk" | "fall" | "climb" | "bounce";

export interface Waypoint {
  readonly node: Node;
  /** How she gets here from the waypoint before; the first waypoint is where she already is. */
  readonly via: Move;
}

export type Goal =
  | { readonly kind: "objective"; readonly objective: Objective }
  | { readonly kind: "eat"; readonly drawingId: DrawingId };

const INK_STEP_RATIO = 0.8;
const SOLID_STEP_RATIO = 0.3;
const WALK_COST = 1;
const RISE_COST = 1;
const FALL_COST = 0.5;
const CLIMB_COST = 1.5;
const BOUNCE_COST = 4;
const BOUNCE_TOUCH_ROWS = 1;
/** Share of the flight she is trusted to steer through when drifting sideways off a bounce. */
const DRIFT_MARGIN = 0.8;
/** Nodes a single search may open before it gives up: the board is endless, her patience is not. */
const SEARCH_BUDGET = 200_000;
const KEY_STRIDE = 1 << 20;

export const footprintFor = (size: AliceSize): Footprint => ({
  cols: Math.ceil((ALICE_BASE.width * ALICE_SCALE[size]) / CELL_PX),
  rows: Math.ceil((ALICE_BASE.height * ALICE_SCALE[size]) / CELL_PX),
});

export const nodeOfFeet = (feet: Vec, footprint: Footprint): Node => ({
  c0: Math.round(feet.x / CELL_PX - footprint.cols / 2),
  r0: Math.round(feet.y / CELL_PX),
});

export const feetOf = (node: Node, footprint: Footprint): Vec => ({
  x: (node.c0 + footprint.cols / 2) * CELL_PX,
  y: node.r0 * CELL_PX,
});

const bodyRange = (node: Node, footprint: Footprint): CellRange => ({
  c0: node.c0,
  c1: node.c0 + footprint.cols,
  r0: node.r0 - footprint.rows,
  r1: node.r0,
});

const bodyRect = (node: Node, footprint: Footprint): Rect => ({
  x: node.c0 * CELL_PX,
  y: (node.r0 - footprint.rows) * CELL_PX,
  width: footprint.cols * CELL_PX,
  height: footprint.rows * CELL_PX,
});

const grow = (range: CellRange, by: number): CellRange => ({
  c0: range.c0 - by,
  c1: range.c1 + by,
  r0: range.r0 - by,
  r1: range.r1 + by,
});

interface Edge {
  readonly to: Node;
  readonly via: Move;
  readonly cost: number;
}

const key = (node: Node): number => node.r0 * KEY_STRIDE + node.c0;

class MinHeap {
  private readonly items: { node: Node; cost: number }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(node: Node, cost: number): void {
    const items = this.items;
    items.push({ node, cost });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const child = items[i];
      const above = items[parent];
      if (child === undefined || above === undefined || above.cost <= child.cost) break;
      items[i] = above;
      items[parent] = child;
      i = parent;
    }
  }

  pop(): { node: Node; cost: number } | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (top === undefined || last === undefined) return top;
    if (items.length === 0) return top;
    items[0] = last;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      const pick = (j: number): void => {
        const a = items[j];
        const b = items[smallest];
        if (a !== undefined && b !== undefined && a.cost < b.cost) smallest = j;
      };
      pick(left);
      pick(right);
      if (smallest === i) break;
      const a = items[i];
      const b = items[smallest];
      if (a === undefined || b === undefined) break;
      items[i] = b;
      items[smallest] = a;
      i = smallest;
    }
    return top;
  }
}

/** Reads the chart with a given body size and finds ways across it. */
export class Pathfinder {
  private readonly killRow: number;
  private readonly arcs = new Map<number, BounceArc>();
  private goal: Goal | null = null;

  constructor(
    private readonly chart: Chart,
    private readonly scene: Scene,
    private readonly footprint: Footprint,
  ) {
    this.killRow = Math.floor(scene.board.killY / CELL_PX);
  }

  isFree(node: Node): boolean {
    const body = bodyRange(node, this.footprint);
    return (
      !this.chart.anyIn(body, CellFlag.solid) && !this.chart.anyIn(grow(body, 1), CellFlag.hazard)
    );
  }

  isSupported(node: Node): boolean {
    const { c0, r0 } = node;
    for (let c = c0; c < c0 + this.footprint.cols; c++) {
      if (this.chart.has(c, r0, CellFlag.solid)) return true;
    }
    return false;
  }

  /** Footing wide enough to come down on from the air: every inner column of the body rests on something. */
  isLandable(node: Node): boolean {
    const { c0, r0 } = node;
    const { cols } = this.footprint;
    const inset = cols >= 3 ? 1 : 0;
    for (let c = c0 + inset; c < c0 + cols - inset; c++) {
      if (!this.chart.has(c, r0, CellFlag.solid)) return false;
    }
    return true;
  }

  isHolding(node: Node): boolean {
    return this.chart.anyIn(bodyRange(node, this.footprint), CellFlag.climbable);
  }

  isStance(node: Node): boolean {
    if (node.r0 > this.killRow) return false;
    return this.isFree(node) && (this.isSupported(node) || this.isHolding(node));
  }

  satisfies(node: Node, goal: Goal): boolean {
    const body = bodyRect(node, this.footprint);
    const { board } = this.scene;
    if (goal.kind === "eat") {
      return this.chart.edibleIn(grow(bodyRange(node, this.footprint), 1)) === goal.drawingId;
    }
    switch (goal.objective) {
      case "key": {
        if (board.key === undefined) return false;
        const reach = expandRect(body, KEY_PICKUP.reachRatio * body.height);
        return distanceToRect(board.key, reach) <= KEY_PICKUP.radius;
      }
      case "door":
        return board.door !== undefined && rectsOverlap(expandRect(body, CELL_PX), board.door);
      case "goal":
        return this.chart.anyIn(bodyRange(node, this.footprint), CellFlag.goal);
    }
  }

  /** Cheapest route from `start` to any node satisfying `goal`, or null. `start` need not be a stance. */
  route(start: Node, goal: Goal): readonly Waypoint[] | null {
    this.goal = goal;
    const cameFrom = new Map<number, Waypoint>();
    const end = this.search(start, cameFrom, (node) => this.satisfies(node, goal));
    return end === null ? null : this.unwind(end, cameFrom);
  }

  /** The way to wherever she can stand that is nearest `point`, for going to the edge and looking. */
  nearestTo(start: Node, point: Vec): readonly Waypoint[] | null {
    this.goal = null;
    const cameFrom = new Map<number, Waypoint>();
    let closest: Node | null = null;
    let closestGap = Number.POSITIVE_INFINITY;
    this.search(start, cameFrom, (node) => {
      if (!this.isStance(node)) return false;
      const feet = feetOf(node, this.footprint);
      const gap = Math.abs(feet.x - point.x) * 4 + Math.abs(feet.y - point.y);
      if (gap < closestGap) {
        closestGap = gap;
        closest = node;
      }
      return false;
    });
    return closest === null ? null : this.unwind(closest, cameFrom);
  }

  private search(
    start: Node,
    cameFrom: Map<number, Waypoint>,
    accept: (node: Node) => boolean,
  ): Node | null {
    const best = new Map<number, number>([[key(start), 0]]);
    const open = new MinHeap();
    open.push(start, 0);
    let opened = 0;

    while (open.size > 0 && opened < SEARCH_BUDGET) {
      const top = open.pop();
      if (top === undefined) break;
      const { node, cost } = top;
      if ((best.get(key(node)) ?? Number.POSITIVE_INFINITY) < cost) continue;
      opened++;
      if (accept(node)) return node;
      for (const edge of this.edgesFrom(node)) {
        const next = cost + edge.cost;
        const k = key(edge.to);
        if (next >= (best.get(k) ?? Number.POSITIVE_INFINITY)) continue;
        best.set(k, next);
        cameFrom.set(k, { node, via: edge.via });
        open.push(edge.to, next);
      }
    }
    return null;
  }

  private unwind(end: Node, cameFrom: Map<number, Waypoint>): readonly Waypoint[] {
    const path: Waypoint[] = [];
    let node = end;
    let from = cameFrom.get(key(node));
    while (from !== undefined) {
      path.push({ node, via: from.via });
      node = from.node;
      from = cameFrom.get(key(node));
    }
    path.push({ node, via: "walk" });
    return path.reverse();
  }

  private *edgesFrom(node: Node): Generator<Edge> {
    const holding = this.isHolding(node);
    const supported = this.isSupported(node);
    if (!supported && !holding) {
      const landing = this.landing(node.c0, node.r0);
      if (landing !== null) {
        yield { to: landing, via: "fall", cost: FALL_COST * (landing.r0 - node.r0) };
      }
      return;
    }
    yield* this.lateral(node, -1);
    yield* this.lateral(node, 1);
    if (holding) {
      const up = { c0: node.c0, r0: node.r0 - 1 };
      if (this.isStance(up)) yield { to: up, via: "climb", cost: CLIMB_COST };
      const down = { c0: node.c0, r0: node.r0 + 1 };
      if (this.isStance(down)) yield { to: down, via: "climb", cost: CLIMB_COST };
    }
    if (supported) yield* this.bounces(node);
  }

  /** Beyond the charted board there is only blank paper: nothing to stand on, nowhere to go. */
  private charted(node: Node): boolean {
    const { c0, c1 } = this.chart.range;
    return node.c0 >= c0 && node.c0 + this.footprint.cols <= c1;
  }

  private *lateral(node: Node, direction: -1 | 1): Generator<Edge> {
    const { rows, cols } = this.footprint;
    const c1 = node.c0 + direction;
    if (!this.charted({ c0: c1, r0: node.r0 })) return;
    const leadingCol = direction > 0 ? c1 + cols - 1 : c1;
    const inkStep = Math.floor(INK_STEP_RATIO * rows);
    const solidStep = Math.max(1, Math.floor(SOLID_STEP_RATIO * rows));

    for (let rise = 0; rise <= inkStep; rise++) {
      const to = { c0: c1, r0: node.r0 - rise };
      if (!this.isFree(to)) continue;
      if (rise > solidStep && this.fixtureBetween(leadingCol, to.r0, node.r0)) return;
      if (this.isSupported(to) || this.isHolding(to)) {
        if (to.r0 <= this.killRow) yield { to, via: "walk", cost: WALK_COST + RISE_COST * rise };
        return;
      }
      if (rise === 0) {
        const landing = this.landing(c1, node.r0);
        if (landing !== null) {
          yield {
            to: landing,
            via: "fall",
            cost: WALK_COST + FALL_COST * (landing.r0 - node.r0),
          };
        }
        return;
      }
    }
  }

  private fixtureBetween(col: number, rowTop: number, rowBottom: number): boolean {
    for (let r = rowTop; r < rowBottom; r++)
      if (this.chart.has(col, r, CellFlag.fixture)) return true;
    return false;
  }

  /** Where a fall down column `c0` ends: on footing, on a hold, or inside the goal (which may lie in a ditch). */
  private landing(c0: number, fromRow: number): Node | null {
    for (let r0 = fromRow + 1; r0 <= this.killRow; r0++) {
      const node = { c0, r0 };
      if (!this.isFree(node)) return null;
      if (this.isSupported(node) || this.isHolding(node)) return node;
      if (this.goal !== null && this.satisfies(node, this.goal)) return node;
      if (r0 >= this.chart.range.r1) return null;
    }
    return null;
  }

  private arcFor(strength: number): BounceArc {
    const known = this.arcs.get(strength);
    if (known !== undefined) return known;
    const arc = this.scene.bounceArc(strength);
    this.arcs.set(strength, arc);
    return arc;
  }

  /** Landings she can reach off a spring under `node`: anything below the apex she can drift to in the flight time. */
  private *bounces(node: Node): Generator<Edge> {
    const { cols } = this.footprint;
    const strength = this.chart.bounceStrengthUnder(node.c0, node.c0 + cols, node.r0);
    if (strength <= 0) return;
    const arc = this.arcFor(strength);
    if (!Number.isFinite(arc.apexPx)) return;
    const riseRows = Math.min(node.r0 - this.chart.range.r0, Math.floor(arc.apexPx / CELL_PX));
    for (let r0 = node.r0 - riseRows; r0 < node.r0 - BOUNCE_TOUCH_ROWS; r0++) {
      const flightTicks = arc.ticksAloftAbove((node.r0 - r0) * CELL_PX);
      if (flightTicks === null) continue;
      const driftCols = Math.floor((this.scene.walkSpeed * flightTicks * DRIFT_MARGIN) / CELL_PX);
      for (let c0 = node.c0 - driftCols; c0 <= node.c0 + driftCols; c0++) {
        const to = { c0, r0 };
        if (!this.charted(to) || !this.isLandable(to) || !this.isFree(to)) continue;
        yield { to, via: "bounce", cost: BOUNCE_COST + RISE_COST * (node.r0 - r0) * 0.25 };
      }
    }
  }
}
