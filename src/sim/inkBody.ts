import Matter from "matter-js";
import { distance, distanceToSegment, type Stroke, type Vec } from "../core/geometry";
import { isInputStrokes } from "../core/inputLimits";
import { INK_THICKNESS } from "../core/world";
import { INK_DOT_RADIUS, MIN_SEGMENT_LENGTH, SIMPLIFY_TOLERANCE } from "./constants";
import type { BodyMaterial } from "./worldPhysics";

export interface InkBodyOptions {
  readonly isStatic: boolean;
  readonly material: BodyMaterial;
  readonly collisionFilter: Matter.ICollisionFilter;
  readonly upright: boolean;
}

/** Ramer–Douglas–Peucker: fewer, longer collider segments with the same silhouette. */
export const simplifyStroke = (stroke: Stroke, tolerance = SIMPLIFY_TOLERANCE): Stroke => {
  if (stroke.length < 3) return stroke;
  const kept = new Set([0, stroke.length - 1]);
  const pending: (readonly [number, number])[] = [[0, stroke.length - 1]];
  for (let range = pending.pop(); range !== undefined; range = pending.pop()) {
    const [start, end] = range;
    const first = stroke[start];
    const last = stroke[end];
    if (first === undefined || last === undefined) continue;
    let farthest = tolerance;
    let split = -1;
    for (let i = start + 1; i < end; i++) {
      const point = stroke[i];
      if (point === undefined) continue;
      const deviation = distanceToSegment(point, first, last);
      if (deviation > farthest) {
        farthest = deviation;
        split = i;
      }
    }
    if (split < 0) continue;
    kept.add(split);
    pending.push([start, split], [split, end]);
  }
  return stroke.filter((_point, index) => kept.has(index));
};

const segmentPart = (start: Vec, end: Vec): Matter.Body =>
  Matter.Bodies.rectangle(
    (start.x + end.x) / 2,
    (start.y + end.y) / 2,
    distance(start, end) + INK_THICKNESS,
    INK_THICKNESS,
    { angle: Math.atan2(end.y - start.y, end.x - start.x) },
  );

const dotPart = (point: Vec): Matter.Body => Matter.Bodies.circle(point.x, point.y, INK_DOT_RADIUS);

const strokeParts = (stroke: Stroke): readonly Matter.Body[] => {
  const points = simplifyStroke(stroke);
  const segments = points
    .slice(1)
    .map((end, i) => ({ start: points[i] ?? end, end }))
    .filter(({ start, end }) => distance(start, end) >= MIN_SEGMENT_LENGTH)
    .map(({ start, end }) => segmentPart(start, end));
  if (segments.length > 0) return segments;
  const [dot] = points;
  return dot === undefined ? [] : [dotPart(dot)];
};

/**
 * matter-js sums part inertias about their own centres and skips the parallel-axis term, which
 * leaves a hollow compound with a fraction of its true inertia: it rocks and creeps forever.
 */
const compoundInertia = (body: Matter.Body): number =>
  body.parts
    .slice(1)
    .reduce(
      (total, part) =>
        total + part.inertia + part.mass * distance(part.position, body.position) ** 2,
      0,
    );

export const buildInkBody = (
  strokes: readonly Stroke[],
  options: InkBodyOptions,
): Matter.Body | null => {
  if (!isInputStrokes(strokes)) return null;
  const parts = strokes.flatMap(strokeParts);
  if (parts.length === 0) return null;
  const body = Matter.Body.create({
    parts,
    isStatic: options.isStatic,
    collisionFilter: { ...options.collisionFilter },
    ...options.material,
  });
  if (!options.isStatic) {
    Matter.Body.setInertia(
      body,
      options.upright ? Number.POSITIVE_INFINITY : compoundInertia(body),
    );
  }
  return body;
};
