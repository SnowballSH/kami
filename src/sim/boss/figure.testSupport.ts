import type { Stroke, Vec } from "../../core/geometry";
import { incarnate } from "../body/drawnBody";
import type { DrawnBody } from "../body/types";
import type { Prey } from "./snipper";

export const HEART: Vec = { x: 100, y: 100 };

export const strokeBetween = (from: Vec, to: Vec, points = 6): Stroke =>
  Array.from({ length: points }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / (points - 1),
    y: from.y + ((to.y - from.y) * i) / (points - 1),
  }));

export const ringAround = (centre: Vec, radius: number, points = 16): Stroke =>
  Array.from({ length: points + 1 }, (_, i) => ({
    x: centre.x + radius * Math.cos((i / points) * Math.PI * 2),
    y: centre.y + radius * Math.sin((i / points) * Math.PI * 2),
  }));

/** A stick figure drawn around `heart`: head, torso ring, two arms, two legs. */
export const figureAround = (heart: Vec): readonly Stroke[] => [
  ringAround({ x: heart.x, y: heart.y - 40 }, 12),
  ringAround(heart, 20),
  strokeBetween({ x: heart.x - 20, y: heart.y - 5 }, { x: heart.x - 50, y: heart.y + 5 }),
  strokeBetween({ x: heart.x + 20, y: heart.y - 5 }, { x: heart.x + 50, y: heart.y + 5 }),
  ...legsBelow(heart),
];

export const legsBelow = (heart: Vec): readonly Stroke[] => [
  strokeBetween({ x: heart.x - 8, y: heart.y + 20 }, { x: heart.x - 12, y: heart.y + 70 }),
  strokeBetween({ x: heart.x + 8, y: heart.y + 20 }, { x: heart.x + 12, y: heart.y + 70 }),
];

/** A stick figure drawn around `HEART`: head, torso ring, two arms, two legs. */
export const FIGURE: readonly Stroke[] = [
  ringAround({ x: 100, y: 60 }, 12),
  ringAround(HEART, 20),
  strokeBetween({ x: 80, y: 95 }, { x: 50, y: 105 }),
  strokeBetween({ x: 120, y: 95 }, { x: 150, y: 105 }),
  strokeBetween({ x: 92, y: 120 }, { x: 88, y: 170 }),
  strokeBetween({ x: 108, y: 120 }, { x: 112, y: 170 }),
];

export const figureBody = (name = "alice"): DrawnBody => incarnate(FIGURE, HEART, name, 0).body;

export const preyOf = (body: DrawnBody = figureBody()): Prey => ({
  heart: HEART,
  body,
  centre: { x: 100, y: 109 },
  facing: 1,
  scale: 1,
});
