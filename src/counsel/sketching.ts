import { boundsOf, type Rect, type Stroke } from "../core/geometry";
import { fitSketch } from "../summoning";
import type { Sketch } from "./types";

/** The sketch pulled to fill `box` exactly, as a bridge is pulled across a gap. */
export const stretchSketch = (sketch: readonly Stroke[], box: Rect): readonly Stroke[] => {
  const bounds = boundsOf(sketch.flat());
  const scaleX = box.width / Math.max(bounds.width, 1);
  const scaleY = box.height / Math.max(bounds.height, 1);
  return sketch.map((stroke) =>
    stroke.map(({ x, y }) => ({
      x: box.x + (x - bounds.x) * scaleX,
      y: box.y + (y - bounds.y) * scaleY,
    })),
  );
};

export const placeSketch = (strokes: readonly Stroke[], sketch: Sketch): readonly Stroke[] =>
  sketch.fit === "stretch" ? stretchSketch(strokes, sketch.box) : fitSketch(strokes, sketch.box);
