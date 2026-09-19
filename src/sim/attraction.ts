import type Matter from "matter-js";
import type { Vec } from "../core/geometry";
import { accelerationOf } from "./worldPhysics";

/** Within this distance the pull is the full strength; beyond, it falls off with the square. */
const FULL_PULL_RADIUS = 160;

/**
 * Pulls every body toward `center` as a planet would: `strengthInG` at close range, weaker with
 * distance. A negative strength pushes away. This is the one force behind "Alice attracts
 * everything" and a drawing named "black hole".
 */
export const pullToward = (
  center: Vec,
  strengthInG: number,
  bodies: readonly Matter.Body[],
): void => {
  if (strengthInG === 0) return;
  for (const body of bodies) {
    const dx = center.x - body.position.x;
    const dy = center.y - body.position.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) continue;
    const falloff = Math.min(1, (FULL_PULL_RADIUS / distance) ** 2);
    const pull = accelerationOf({
      x: (dx / distance) * strengthInG * falloff,
      y: (dy / distance) * strengthInG * falloff,
    });
    body.force.x += body.mass * pull.x;
    body.force.y += body.mass * pull.y;
  }
};
