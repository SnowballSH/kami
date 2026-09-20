export interface Vec {
  readonly x: number;
  readonly y: number;
}

/** Axis-aligned, `x`/`y` is the top-left corner. World space is y-down. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A point the pen passed through. `pressure` is 0–1 where the hardware reports it; a mouse or a finger leaves it out. */
export interface PenPoint extends Vec {
  readonly pressure?: number;
}

export type Stroke = readonly PenPoint[];

/**
 * Where a rigid thing is now relative to where it was made.
 * A point drawn at `p` is currently at `position + rotate(p - origin, angle)`.
 */
/** Where a drawing is now: drawn points are scaled about `origin`, turned by `angle`, and set at `position`. */
export interface Pose {
  readonly origin: Vec;
  readonly position: Vec;
  readonly angle: number;
  readonly scale: number;
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const distance = (a: Vec, b: Vec): number => Math.hypot(b.x - a.x, b.y - a.y);

export const strokeLength = (stroke: Stroke): number =>
  stroke.slice(1).reduce((total, point, i) => total + distance(stroke[i] ?? point, point), 0);

export const strokesLength = (strokes: readonly Stroke[]): number =>
  strokes.reduce((total, stroke) => total + strokeLength(stroke), 0);

export const boundsOf = (points: readonly Vec[]): Rect => {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

export const rectCenter = (rect: Rect): Vec => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

export const expandRect = (rect: Rect, margin: number): Rect => ({
  x: rect.x - margin,
  y: rect.y - margin,
  width: rect.width + margin * 2,
  height: rect.height + margin * 2,
});

export const rectContains = (rect: Rect, point: Vec): boolean =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.width &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.height;

export const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export const remainingColumns = (solid: Rect, cuts: readonly Rect[]): Rect[] => {
  const edges = cuts
    .filter((cut) => rectsOverlap(cut, solid))
    .map((cut) => [cut.x, cut.x + cut.width] as const)
    .sort(([a], [b]) => a - b);
  if (edges.length === 0) return [solid];
  const remains: Rect[] = [];
  let from = solid.x;
  for (const [left, right] of edges) {
    if (left > from) remains.push({ ...solid, x: from, width: left - from });
    from = Math.max(from, right);
  }
  const end = solid.x + solid.width;
  if (end > from) remains.push({ ...solid, x: from, width: end - from });
  return remains;
};

export const distanceToRect = (point: Vec, rect: Rect): number =>
  Math.hypot(
    Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width)),
    Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height)),
  );

/** The shortest distance between two rects; 0 when they touch or overlap. */
export const rectGap = (a: Rect, b: Rect): number =>
  Math.hypot(
    Math.max(a.x - (b.x + b.width), 0, b.x - (a.x + a.width)),
    Math.max(a.y - (b.y + b.height), 0, b.y - (a.y + a.height)),
  );

export const translateRect = (rect: Rect, by: Vec): Rect => ({
  ...rect,
  x: rect.x + by.x,
  y: rect.y + by.y,
});

export const distanceToSegment = (point: Vec, a: Vec, b: Vec): number => {
  const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (lengthSquared === 0) return distance(point, a);
  const t = clamp(
    ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / lengthSquared,
    0,
    1,
  );
  return distance(point, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
};

export const distanceToStroke = (point: Vec, stroke: Stroke): number => {
  const [first] = stroke;
  if (first === undefined) return Number.POSITIVE_INFINITY;
  if (stroke.length === 1) return distance(point, first);
  return Math.min(
    ...stroke.slice(1).map((end, i) => distanceToSegment(point, stroke[i] ?? end, end)),
  );
};

const rotate = (v: Vec, angle: number): Vec => ({
  x: v.x * Math.cos(angle) - v.y * Math.sin(angle),
  y: v.x * Math.sin(angle) + v.y * Math.cos(angle),
});

export const IDENTITY_POSE: Pose = {
  origin: { x: 0, y: 0 },
  position: { x: 0, y: 0 },
  angle: 0,
  scale: 1,
};

export const scaleAbout = (point: Vec, centre: Vec, scale: number): Vec => ({
  x: centre.x + (point.x - centre.x) * scale,
  y: centre.y + (point.y - centre.y) * scale,
});

export const poseToWorld = (drawn: Vec, pose: Pose): Vec => {
  const local = rotate(
    {
      x: (drawn.x - pose.origin.x) * pose.scale,
      y: (drawn.y - pose.origin.y) * pose.scale,
    },
    pose.angle,
  );
  return { x: pose.position.x + local.x, y: pose.position.y + local.y };
};

export const worldToPose = (world: Vec, pose: Pose): Vec => {
  const local = rotate({ x: world.x - pose.position.x, y: world.y - pose.position.y }, -pose.angle);
  return {
    x: pose.origin.x + local.x / pose.scale,
    y: pose.origin.y + local.y / pose.scale,
  };
};
