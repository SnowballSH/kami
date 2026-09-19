import type { Stroke, Vec } from "../../src/core/geometry";

const CIRCLE_POINTS = 32;

export const circleSketch = (centre: Vec, radius: number, wobble = 0): readonly Stroke[] => [
  Array.from({ length: CIRCLE_POINTS + 1 }, (_, index) => {
    const angle = (index / CIRCLE_POINTS) * Math.PI * 2;
    const r = radius * (1 + wobble * Math.sin(angle * 3));
    return { x: centre.x + r * Math.cos(angle), y: centre.y + r * Math.sin(angle) };
  }),
];

export const lineSketch = (from: Vec, to: Vec): readonly Stroke[] => [[from, to]];

export const transformSketch = (
  strokes: readonly Stroke[],
  scale: number,
  offset: Vec,
): readonly Stroke[] =>
  strokes.map((stroke) =>
    stroke.map(({ x, y }) => ({ x: x * scale + offset.x, y: y * scale + offset.y })),
  );
