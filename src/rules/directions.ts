import type { Vec } from "../core/geometry";
import type { Vocabulary } from "./vocabulary";

export type Direction = "up" | "down" | "left" | "right";

const SIDEWAYS: Direction = "right";

const DIRECTIONS: ReadonlyMap<string, Direction> = new Map([
  ["up", "up"],
  ["upward", "up"],
  ["upwards", "up"],
  ["skyward", "up"],
  ["north", "up"],
  ["down", "down"],
  ["downward", "down"],
  ["downwards", "down"],
  ["south", "down"],
  ["left", "left"],
  ["leftward", "left"],
  ["leftwards", "left"],
  ["west", "left"],
  ["right", "right"],
  ["rightward", "right"],
  ["rightwards", "right"],
  ["east", "right"],
  ["sideways", SIDEWAYS],
  ["sideway", SIDEWAYS],
  ["sidewards", SIDEWAYS],
  ["horizontal", SIDEWAYS],
]);

export const DIRECTION_WORDS: Vocabulary = new Set(DIRECTIONS.keys());

const UNIT_VECTORS: Readonly<Record<Direction, Vec>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITES: Readonly<Record<Direction, Direction>> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

export const DIRECTION_LABELS: Readonly<Record<Direction, string>> = {
  up: "upward",
  down: "downward",
  left: "to the left",
  right: "to the right",
};

export const readDirection = (words: readonly string[]): Direction | null =>
  words.map((word) => DIRECTIONS.get(word)).find((direction) => direction !== undefined) ?? null;

export const opposite = (direction: Direction): Direction => OPPOSITES[direction];

/** A field of `size` along `direction`; a negative size points the other way. Never yields -0. */
export const fieldAlong = (direction: Direction, size: number): Vec => {
  const unit = UNIT_VECTORS[direction];
  return { x: unit.x * size || 0, y: unit.y * size || 0 };
};

export const directionOf = ({ x, y }: Vec): Direction => {
  if (Math.abs(x) > Math.abs(y)) return x < 0 ? "left" : "right";
  return y < 0 ? "up" : "down";
};
