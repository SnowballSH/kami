import type Matter from "matter-js";
import type { Nature } from "../cat/types";
import type { Vec } from "../core/geometry";
import type { WorldPhysics } from "../rules/types";
import { accelerationOf, push } from "./worldPhysics";

const FULL_TURN = 360;
const HALF_TURN = 180;
const MS_PER_SECOND = 1000;

/** Drawings with a mind or a driver walk the paper; only these tumble toward the room's down. */
const OF_THE_PAPER: ReadonlySet<Nature> = new Set<Nature>(["walker", "hopper", "flier", "vehicle"]);

export const isLooseInk = (nature: Nature): boolean => !OF_THE_PAPER.has(nature);

/** Into (-180, 180]. */
export const wrappedAngle = (degrees: number): number => {
  const turned = ((((degrees + HALF_TURN) % FULL_TURN) + FULL_TURN) % FULL_TURN) - HALF_TURN;
  return turned === -HALF_TURN ? HALF_TURN : turned;
};

/** A field given in the room's frame, as the paper sees it once turned `angle` degrees clockwise. */
export const onPaper = (inRoom: Vec, angle: number): Vec => {
  const radians = (-angle * Math.PI) / HALF_TURN;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: inRoom.x * cos - inRoom.y * sin, y: inRoom.x * sin + inRoom.y * cos };
};

/**
 * How far the page is turned on screen. The tilt law sets a resting angle; the spin law keeps it
 * turning from there, and a new tilt starts the count over. Time on the paper drives the spin, so
 * slow motion slows the turning too.
 */
export class PaperTurn {
  private tilt = 0;
  private spun = 0;

  get angle(): number {
    return wrappedAngle(this.tilt + this.spun);
  }

  obey(physics: WorldPhysics): void {
    if (physics.tilt !== this.tilt) this.spun = 0;
    this.tilt = physics.tilt;
  }

  advance(physics: WorldPhysics, elapsedMs: number): void {
    if (physics.worldSpin === 0) return;
    this.spun = wrappedAngle(this.spun + (physics.worldSpin * elapsedMs) / MS_PER_SECOND);
  }

  /** The room's gravity over the paper's, for what is loose on it. Nothing at rest upright. */
  tumble(gravityInG: Vec, bodies: Iterable<Matter.Body>): void {
    const angle = this.angle;
    if (angle === 0) return;
    const inRoom = onPaper(gravityInG, angle);
    const extra = accelerationOf({ x: inRoom.x - gravityInG.x, y: inRoom.y - gravityInG.y });
    for (const body of bodies) push(body, extra);
  }
}
