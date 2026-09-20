import {
  boundsOf,
  distanceToSegment,
  distanceToStroke,
  type Rect,
  rectCenter,
  type Stroke,
  strokeLength,
  type Vec,
} from "../../core/geometry";
import { INK_THICKNESS } from "../../core/world";
import { EFFECT_DOMAINS } from "../../rules/effectDomains";
import { BODY_TUNING } from "../boss/tuning";
import { ALICE_BASE } from "../types";
import {
  type Abilities,
  BODY_PARTS,
  type BodyFrame,
  type BodyPartKind,
  type BodyStroke,
  type Cut,
  type DrawnBody,
  type Grafted,
  type Snipped,
} from "./types";

const WINGED_NAME =
  /\b(wing|wings|winged|bird|angel|fairy|butterfly|moth|dragon|bat|bee|flying)\b/i;

export interface Incarnated {
  readonly body: DrawnBody;
  readonly centre: Vec;
}

export interface BodySpace {
  readonly centre: Vec;
  readonly facing: -1 | 1;
  readonly scale: number;
}

export const namesWings = (name: string): boolean => WINGED_NAME.test(name);

export const toBodySpace = (world: Vec, { centre, facing, scale }: BodySpace): Vec => ({
  x: ((world.x - centre.x) / scale) * facing,
  y: (world.y - centre.y) / scale,
});

export const toWorldSpace = (local: Vec, { centre, facing, scale }: BodySpace): Vec => ({
  x: centre.x + local.x * facing * scale,
  y: centre.y + local.y * scale,
});

const centroidOf = (stroke: Stroke): Vec => {
  const sum = stroke.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), {
    x: 0,
    y: 0,
  });
  return { x: sum.x / stroke.length, y: sum.y / stroke.length };
};

const encloses = (stroke: Stroke, point: Vec): boolean => {
  let inside = false;
  for (let i = 0, j = stroke.length - 1; i < stroke.length; j = i++) {
    const a = stroke[i];
    const b = stroke[j];
    if (a === undefined || b === undefined) continue;
    const straddles = a.y > point.y !== b.y > point.y;
    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
};

export const partOf = (
  stroke: Stroke,
  heart: Vec,
  frame: BodyFrame,
  winged: boolean,
): BodyPartKind => {
  const hug = BODY_TUNING.torsoHug * Math.min(frame.width, frame.height);
  if (encloses(stroke, heart) || distanceToStroke(heart, stroke) <= hug) return "torso";
  const centroid = centroidOf(stroke);
  if (centroid.y > BODY_TUNING.legsBelow * frame.height) return "legs";
  if (centroid.y < -BODY_TUNING.headAbove * frame.height) {
    const out = (winged ? BODY_TUNING.namedWingsOut : BODY_TUNING.wingsOut) * frame.width;
    return Math.abs(centroid.x) > out ? "wings" : "head";
  }
  return "arms";
};

const inkOf = (strokes: readonly BodyStroke[]): Readonly<Record<BodyPartKind, number>> => {
  const ink = { head: 0, torso: 0, arms: 0, legs: 0, wings: 0 };
  for (const { stroke, part } of strokes) ink[part] += strokeLength(stroke);
  return ink;
};

const isAlive = (body: DrawnBody, part: BodyPartKind, ink = inkOf(body.strokes)): boolean =>
  body.fullest[part] > 0 && ink[part] >= BODY_TUNING.partAliveRatio * body.fullest[part];

export const aliveParts = (body: DrawnBody): readonly BodyPartKind[] => {
  const ink = inkOf(body.strokes);
  return BODY_PARTS.filter((part) => isAlive(body, part, ink));
};

export const abilitiesOf = (body: DrawnBody): Abilities => {
  const alive = new Set(aliveParts(body));
  return {
    walk: alive.has("legs"),
    jump: alive.has("legs"),
    climb: alive.has("arms"),
    fly: alive.has("wings"),
    see: alive.has("head"),
  };
};

export const EVERY_ABILITY: Abilities = {
  walk: true,
  jump: true,
  climb: true,
  fly: false,
  see: true,
};

const fitInto = (bounds: Rect): number => {
  const { min, max } = EFFECT_DOMAINS.aliceSize;
  const height = Math.max(bounds.height, 1);
  const width = Math.max(bounds.width, 1);
  const grow = Math.max(1, (ALICE_BASE.height * min) / height, (ALICE_BASE.width * min) / width);
  if (grow > 1) return grow;
  return Math.min(1, (ALICE_BASE.height * max) / height, (ALICE_BASE.height * max) / width);
};

const heartWithin = (heart: Vec, frame: BodyFrame): Vec =>
  Math.abs(heart.x) <= frame.width / 2 && Math.abs(heart.y) <= frame.height / 2
    ? heart
    : { x: 0, y: -frame.height * 0.1 };

const fullestOf = (
  was: Readonly<Record<BodyPartKind, number>>,
  strokes: readonly BodyStroke[],
): Readonly<Record<BodyPartKind, number>> => {
  const ink = inkOf(strokes);
  return {
    head: Math.max(was.head, ink.head),
    torso: Math.max(was.torso, ink.torso),
    arms: Math.max(was.arms, ink.arms),
    legs: Math.max(was.legs, ink.legs),
    wings: Math.max(was.wings, ink.wings),
  };
};

const NO_INK: Readonly<Record<BodyPartKind, number>> = {
  head: 0,
  torso: 0,
  arms: 0,
  legs: 0,
  wings: 0,
};

/** The strokes drawn for her become her: sized within what the laws allow, segmented about the heart. */
export const incarnate = (
  worldStrokes: readonly Stroke[],
  heartWorld: Vec,
  name: string,
  nowMs: number,
): Incarnated => {
  const bounds = boundsOf(worldStrokes.flat());
  const fit = fitInto(bounds);
  const centre = rectCenter(bounds);
  const frame: BodyFrame = { width: bounds.width * fit, height: bounds.height * fit };
  const local = (point: Vec): Vec => ({
    x: (point.x - centre.x) * fit,
    y: (point.y - centre.y) * fit,
  });
  const heart = heartWithin(local(heartWorld), frame);
  const winged = namesWings(name);
  const strokes = worldStrokes
    .map((stroke) => stroke.map(local))
    .map((stroke) => ({ stroke, part: partOf(stroke, heart, frame, winged), sinceMs: nowMs }));
  return {
    body: { strokes, heart, frame, fullest: fullestOf(NO_INK, strokes) },
    centre,
  };
};

const segmentsCross = (a: Vec, b: Vec, c: Vec, d: Vec): boolean => {
  const orient = (p: Vec, q: Vec, r: Vec): number =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abc = orient(a, b, c);
  const abd = orient(a, b, d);
  const cda = orient(c, d, a);
  const cdb = orient(c, d, b);
  return abc * abd < 0 && cda * cdb < 0;
};

export const cutCrosses = (cut: Cut, stroke: Stroke): boolean => {
  if (stroke.some((point) => distanceToSegment(point, cut.from, cut.to) <= INK_THICKNESS / 2))
    return true;
  return stroke.some((end, i) => {
    const start = stroke[i - 1];
    return start !== undefined && segmentsCross(cut.from, cut.to, start, end);
  });
};

/** The blades close on the part they were aimed at; other strokes they pass are spared. */
export const snip = (body: DrawnBody, cut: Cut, part: BodyPartKind): Snipped => {
  const removed = body.strokes.filter(
    ({ stroke, part: strokePart }) => strokePart === part && cutCrosses(cut, stroke),
  );
  const remaining = body.strokes.filter((stroke) => !removed.includes(stroke));
  const after: DrawnBody = { ...body, strokes: remaining };
  const wasAlive = aliveParts(body);
  const stillAlive = new Set(aliveParts(after));
  const bare = !body.strokes.some(({ part }) => part === "torso");
  return {
    body: after,
    removed,
    lost: wasAlive.filter((part) => !stillAlive.has(part)),
    heartCut: bare && distanceToSegment(body.heart, cut.from, cut.to) <= BODY_TUNING.heartRadius,
  };
};

const touchesBody = (body: DrawnBody, stroke: Stroke): boolean => {
  const reach = BODY_TUNING.graftReach;
  const within: Rect = {
    x: -body.frame.width / 2 - reach,
    y: -body.frame.height / 2 - reach,
    width: body.frame.width + 2 * reach,
    height: body.frame.height + 2 * reach,
  };
  return stroke.some(
    (point) =>
      (point.x >= within.x &&
        point.x <= within.x + within.width &&
        point.y >= within.y &&
        point.y <= within.y + within.height) ||
      body.strokes.some((own) => distanceToStroke(point, own.stroke) <= reach),
  );
};

/** Strokes drawn onto her join her, each becoming the part its place says; null if none reached her. */
export const graft = (
  body: DrawnBody,
  localStrokes: readonly Stroke[],
  nowMs: number,
  winged = false,
): Grafted | null => {
  if (!localStrokes.some((stroke) => touchesBody(body, stroke))) return null;
  const added = localStrokes.map((stroke) => ({
    stroke,
    part: partOf(stroke, body.heart, body.frame, winged),
    sinceMs: nowMs,
  }));
  const strokes = [...body.strokes, ...added];
  const after: DrawnBody = { ...body, strokes, fullest: fullestOf(body.fullest, strokes) };
  const wasAlive = new Set(aliveParts(body));
  return {
    body: after,
    added,
    restored: aliveParts(after).filter((part) => !wasAlive.has(part)),
  };
};

export const heartInWorld = (body: DrawnBody, space: BodySpace): Vec =>
  toWorldSpace(body.heart, space);

export const bodyStrokesInWorld = (body: DrawnBody, space: BodySpace): readonly Stroke[] =>
  body.strokes.map(({ stroke }) => stroke.map((point) => toWorldSpace(point, space)));

/** The far end of a part from the heart, and how far out it reaches, in body space. */
export const partReach = (
  body: DrawnBody,
  part: BodyPartKind,
): { readonly tip: Vec; readonly distance: number } | null => {
  const points = body.strokes.filter((stroke) => stroke.part === part).flatMap((s) => s.stroke);
  if (points.length === 0) return null;
  let tip = points[0] ?? body.heart;
  let farthest = -1;
  for (const point of points) {
    const away = Math.hypot(point.x - body.heart.x, point.y - body.heart.y);
    if (away > farthest) {
      farthest = away;
      tip = point;
    }
  }
  return { tip, distance: farthest };
};
