import { distance, type Vec } from "../core/geometry";
import type { WorldPhysics } from "../rules/types";
import { LANTERN_LIGHT_PX, PITCH_DARK_BELOW } from "./constants";
import type { InkEntity } from "./inkEntity";
import { centreOf } from "./portals";

export const isPitchDark = (physics: WorldPhysics): boolean => physics.daylight < PITCH_DARK_BELOW;

/** In pitch dark she sees only by lantern light: outside every lit drawing's pool she will not take a step. */
export const seesHerWay = (physics: WorldPhysics, at: Vec, inks: readonly InkEntity[]): boolean =>
  !isPitchDark(physics) ||
  inks.some((ink) => ink.lit && distance(centreOf(ink), at) <= LANTERN_LIGHT_PX);
