import { CELL_PX, CellFlag, Chart } from "../autopilot/chart";
import type { Scene } from "../autopilot/types";
import type { Vec } from "../core/geometry";
import type { Surroundings } from "./types";

/** How far ahead Kami looks for a far bank or a wall, and how far down for ground under a gap. */
export const LOOKAHEAD_PX = 1200;
export const LOOKDOWN_PX = 480;

const cellOf = (px: number): number => Math.floor(px / CELL_PX);

const feetOf = (scene: Scene): Vec => ({
  x: scene.alice.center.x,
  y: scene.alice.center.y + scene.alice.height / 2,
});

class Lookout {
  private readonly rFeet: number;
  private readonly hop: number;

  constructor(
    private readonly chart: Chart,
    private readonly scene: Scene,
    private readonly feet: Vec,
  ) {
    this.rFeet = cellOf(feet.y);
    this.hop = Math.max(1, Math.floor(scene.jumpArc.apexPx / CELL_PX));
  }

  /** Row of the first solid cell in a column, from a hop above her feet down to the look-down limit. */
  private groundRow(c: number): number | null {
    const top = this.rFeet - this.hop;
    const bottom = this.rFeet + cellOf(LOOKDOWN_PX);
    for (let r = top; r <= bottom; r++) if (this.chart.has(c, r, CellFlag.solid)) return r;
    return null;
  }

  private topOfRise(c: number, from: number): number {
    let r = from;
    while (this.chart.contains(c, r - 1) && this.chart.has(c, r - 1, CellFlag.solid)) r--;
    return r;
  }

  look(facing: -1 | 1): Surroundings | null {
    const halfWidth = Math.ceil(this.scene.alice.width / 2 / CELL_PX);
    const start = cellOf(this.feet.x) + facing * (halfWidth + 1);
    const reach = cellOf(LOOKAHEAD_PX);
    for (let step = 0; step < reach; step++) {
      const c = start + facing * step;
      const ground = this.groundRow(c);
      if (ground === null) return this.acrossFrom(c, facing, reach - step);
      if (ground <= this.rFeet - this.hop) {
        const top = this.topOfRise(c, ground);
        const x = facing === 1 ? c * CELL_PX : (c + 1) * CELL_PX;
        return {
          kind: "wall",
          face: { x, y: top * CELL_PX, width: 0, height: this.feet.y - top * CELL_PX },
          toward: facing,
        };
      }
    }
    return null;
  }

  private acrossFrom(cEdge: number, facing: -1 | 1, reach: number): Surroundings {
    const edgeX = facing === 1 ? cEdge * CELL_PX : (cEdge + 1) * CELL_PX;
    for (let step = 1; step < reach; step++) {
      const c = cEdge + facing * step;
      const ground = this.groundRow(c);
      if (ground === null) continue;
      const bankX = facing === 1 ? c * CELL_PX : (c + 1) * CELL_PX;
      const x = Math.min(edgeX, bankX);
      return {
        kind: "gap",
        span: { x, y: this.feet.y, width: Math.abs(bankX - edgeX), height: 0 },
      };
    }
    return { kind: "drop", edge: { x: edgeX, y: this.feet.y } };
  }
}

const URGENCY: Readonly<Record<Surroundings["kind"], number>> = {
  gap: 0,
  wall: 1,
  drop: 2,
  open: 3,
};

/**
 * Reads the page both ways from Alice. A gap or a drop is where the ground under her feet stops; a
 * wall is a rise taller than she can jump. Something to cross beats something to climb beats the
 * page running out, and the way she faces wins a tie.
 */
export const surroundingsOf = (scene: Scene): Surroundings => {
  const feet = feetOf(scene);
  const { facing, width } = scene.alice;
  const open: Surroundings = {
    kind: "open",
    beside: { x: feet.x + facing * (width + 60), y: feet.y },
  };
  const chart = Chart.of(scene);
  if (chart === null) return open;
  const lookout = new Lookout(chart, scene, feet);
  const ahead = lookout.look(facing) ?? open;
  const behind = lookout.look(facing === 1 ? -1 : 1) ?? open;
  return URGENCY[behind.kind] < URGENCY[ahead.kind] ? behind : ahead;
};
