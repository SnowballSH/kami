import type { Vocabulary } from "./vocabulary";

export interface CelestialBody {
  readonly label: string;
  /** Surface gravity in g. */
  readonly gravity: number;
}

const SUN: CelestialBody = { label: "the Sun", gravity: 27.9 };
const MERCURY: CelestialBody = { label: "Mercury", gravity: 0.38 };
const VENUS: CelestialBody = { label: "Venus", gravity: 0.9 };
export const EARTH_BODY: CelestialBody = { label: "Earth", gravity: 1 };
const MOON: CelestialBody = { label: "the Moon", gravity: 0.165 };
const MARS: CelestialBody = { label: "Mars", gravity: 0.38 };
const JUPITER: CelestialBody = { label: "Jupiter", gravity: 2.53 };
const SATURN: CelestialBody = { label: "Saturn", gravity: 1.06 };
const URANUS: CelestialBody = { label: "Uranus", gravity: 0.89 };
const NEPTUNE: CelestialBody = { label: "Neptune", gravity: 1.14 };
const PLUTO: CelestialBody = { label: "Pluto", gravity: 0.063 };

const BODIES: ReadonlyMap<string, CelestialBody> = new Map([
  ["sun", SUN],
  ["solar", SUN],
  ["mercury", MERCURY],
  ["venus", VENUS],
  ["earth", EARTH_BODY],
  ["earths", EARTH_BODY],
  ["terrestrial", EARTH_BODY],
  ["moon", MOON],
  ["moons", MOON],
  ["lunar", MOON],
  ["luna", MOON],
  ["mars", MARS],
  ["martian", MARS],
  ["jupiter", JUPITER],
  ["jovian", JUPITER],
  ["saturn", SATURN],
  ["uranus", URANUS],
  ["neptune", NEPTUNE],
  ["pluto", PLUTO],
]);

export const BODY_WORDS: Vocabulary = new Set(BODIES.keys());

export const readBody = (words: readonly string[]): CelestialBody | null =>
  words.map((word) => BODIES.get(word)).find((body) => body !== undefined) ?? null;
