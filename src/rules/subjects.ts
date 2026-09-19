import type { Governs } from "./types";
import { type Vocabulary, vocabulary } from "./vocabulary";

export const GOVERNS = [
  "gravity",
  "timeScale",
  "friction",
  "bounciness",
  "airDrag",
  "wind",
  "temperature",
  "daylight",
  "flight",
  "walkSpeed",
  "aliceSize",
  "attraction",
  "clones",
] as const satisfies readonly Governs[];

/** How the player refers to Alice; the dials on her need one of these beside the topic. */
export const ALICE = vocabulary("alice, alices, her, she, herself, girl, character, player, hero");

/** The topic word each dial answers to: what a sentence must mention to be about it. */
export const SUBJECTS: Readonly<Record<Governs, Vocabulary>> = {
  gravity: vocabulary(`
    g, gs, gravity, gravitational, gravitation, grav, antigravity, fall, falls, falling
  `),
  timeScale: vocabulary("time, timescale, speed, tempo, clock, realtime"),
  friction: vocabulary("friction, grip, traction"),
  bounciness: vocabulary("bounciness, bounce, restitution, elasticity"),
  airDrag: vocabulary("air, airdrag, drag, atmosphere"),
  wind: vocabulary("wind, winds, breeze, gust, gusts, draft, draught, gale, storm, hurricane"),
  temperature: vocabulary("temperature, temp, degrees, celsius, heat, weather, climate"),
  daylight: vocabulary("daylight, daytime, sky, lighting"),
  flight: vocabulary("flight, wings, fly, flies, flying, hover, hovers, levitate, levitates"),
  walkSpeed: vocabulary("pace, stride, strides, legs, walking"),
  aliceSize: vocabulary("size, sized, height, stature"),
  attraction: vocabulary("attraction, magnetism, magnetic, pull"),
  clones: vocabulary("clone, clones, cloned, copies, copy, twin, twins, duplicate, duplicates"),
};
