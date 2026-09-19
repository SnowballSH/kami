import type { Governs } from "./types";
import { type Vocabulary, vocabulary } from "./vocabulary";

export const GOVERNS = [
  "gravity",
  "timeScale",
  "friction",
  "bounciness",
  "airDrag",
  "wind",
] as const satisfies readonly Governs[];

export const SUBJECTS: Readonly<Record<Governs, Vocabulary>> = {
  gravity: vocabulary(`
    g, gs, gravity, gravitational, gravitation, grav, antigravity, fall, falls, falling
  `),
  timeScale: vocabulary("time, timescale, speed, tempo, clock, realtime"),
  friction: vocabulary("friction, grip, traction"),
  bounciness: vocabulary("bounciness, bounce, restitution, elasticity"),
  airDrag: vocabulary("air, airdrag, drag, atmosphere"),
  wind: vocabulary("wind, winds, breeze, gust, gusts, draft, draught, gale, storm, hurricane"),
};
