import type { Stroke, Vec } from "../core/geometry";
import type { SpawnShape } from "./types";

const POINT_SPACING = 6;
const BLOB_WOBBLE = 0.12;
const MIN_SIDE = 4;

const segment = (from: Vec, to: Vec): Stroke => {
  const count = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / POINT_SPACING));
  return Array.from({ length: count + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / count,
    y: from.y + ((to.y - from.y) * i) / count,
  }));
};

const ring = (center: Vec, rx: number, ry: number, wobble: number): Stroke => {
  const count = Math.max(12, Math.ceil((Math.PI * (rx + ry)) / POINT_SPACING));
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = (i / count) * Math.PI * 2;
    const swell = 1 + wobble * Math.sin(3 * t) * Math.cos(2 * t);
    return { x: center.x + rx * swell * Math.cos(t), y: center.y + ry * swell * Math.sin(t) };
  });
};

/** Strokes for a conjured drawing, centred on `at` in world px. */
export const shapeStrokes = (
  shape: SpawnShape,
  at: Vec,
  width: number,
  height: number,
): readonly Stroke[] => {
  const w = Math.max(MIN_SIDE, width);
  const h = Math.max(MIN_SIDE, height);
  const left = at.x - w / 2;
  const right = at.x + w / 2;
  const top = at.y - h / 2;
  const bottom = at.y + h / 2;
  switch (shape) {
    case "line":
      return [segment({ x: left, y: at.y }, { x: right, y: at.y })];
    case "box":
      return [
        [
          ...segment({ x: left, y: top }, { x: right, y: top }),
          ...segment({ x: right, y: top }, { x: right, y: bottom }).slice(1),
          ...segment({ x: right, y: bottom }, { x: left, y: bottom }).slice(1),
          ...segment({ x: left, y: bottom }, { x: left, y: top }).slice(1),
        ],
      ];
    case "circle":
      return [ring(at, w / 2, h / 2, 0)];
    case "blob":
      return [ring(at, w / 2, h / 2, BLOB_WOBBLE)];
  }
};
