import { poseToWorld, type Stroke, type Vec } from "../core/geometry";
import type { AliceSnapshot, SumikuiSnapshot, WorldSnapshot } from "../sim/types";
import { TAU } from "./canvas2d";
import { MARKER, rgbCss } from "./palette";
import type { InkView } from "./types";

const FLECKS = 12;
const FLECK_FLIGHT_MS = 520;
const FLECK_RADIUS = 1.9;
const FLECK_SCATTER = 14;
const FLECK_ARC = 18;
const DRIPS = 3;
const DRIP_FALL_MS = 900;
const DRIP_FALL = 26;
const DRIP_RADIUS = 2.1;
const DRIP_SPREAD = 10;
const MOUTH_OFFSET: Vec = { x: 0, y: 8 };
const MAX_REACH = 900;

export interface FeedingParticle {
  readonly at: Vec;
  readonly radius: number;
  readonly alpha: number;
}

export interface Feeding {
  readonly source: Vec;
  readonly mouth: Vec;
}

const hash = (seed: number): number => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

/** The point where the teeth are: strokes go from the last drawn backwards, so this is the frontier of what is left. */
export const biteFrontier = (strokes: readonly Stroke[], bite: number): Vec | null => {
  const total = strokes.reduce((sum, stroke) => sum + stroke.length, 0);
  if (total === 0) return null;
  let budget = Math.max(0, Math.floor(total * (1 - bite)));
  for (const stroke of strokes) {
    const point = stroke[Math.min(budget, stroke.length - 1)];
    if (budget < stroke.length && point !== undefined) return point;
    budget -= stroke.length;
  }
  const last = strokes.at(-1)?.at(-1);
  return last ?? null;
};

const preyOf = (world: WorldSnapshot, sumikui: SumikuiSnapshot): AliceSnapshot | null =>
  sumikui.prey === null
    ? null
    : sumikui.prey === 0
      ? world.alice
      : (world.twins[sumikui.prey - 1] ?? null);

const sourceOf = (
  world: WorldSnapshot,
  sumikui: SumikuiSnapshot,
  inks: readonly InkView[],
): Vec | null => {
  switch (sumikui.quarry) {
    case "ink": {
      const chewed = inks.find((ink) => ink.drawing.id === sumikui.chewing);
      if (chewed === undefined) return null;
      const frontier = biteFrontier(chewed.drawing.strokes, sumikui.bite);
      return frontier === null ? null : poseToWorld(frontier, chewed.pose);
    }
    case "paper": {
      const prey = preyOf(world, sumikui);
      return prey === null ? null : { x: prey.center.x, y: prey.center.y + prey.height / 2 };
    }
    case "alice":
      return preyOf(world, sumikui)?.center ?? null;
    case null:
      return null;
  }
};

/** Where the meal is coming from and where it is going, while the Sumikui is feeding; null otherwise. */
export const feedingOf = (world: WorldSnapshot, inks: readonly InkView[]): Feeding | null => {
  const { sumikui } = world;
  if (sumikui === null || sumikui.phase !== "feeding") return null;
  const source = sourceOf(world, sumikui, inks);
  if (source === null) return null;
  const mouth = { x: sumikui.centre.x + MOUTH_OFFSET.x, y: sumikui.centre.y + MOUTH_OFFSET.y };
  if (Math.hypot(mouth.x - source.x, mouth.y - source.y) > MAX_REACH) return null;
  return { source, mouth };
};

const fleckAt = ({ source, mouth }: Feeding, index: number, nowMs: number): FeedingParticle => {
  const t = (nowMs / FLECK_FLIGHT_MS + hash(index)) % 1;
  const scatter = {
    x: (hash(index * 7 + 1) - 0.5) * 2 * FLECK_SCATTER,
    y: (hash(index * 7 + 2) - 0.5) * 2 * FLECK_SCATTER,
  };
  const eased = t * t;
  const lift = Math.sin(t * Math.PI) * FLECK_ARC * (hash(index * 7 + 3) - 0.5) * 2;
  return {
    at: {
      x: lerp(source.x + scatter.x, mouth.x, eased),
      y: lerp(source.y + scatter.y, mouth.y, eased) - lift,
    },
    radius: FLECK_RADIUS * (0.6 + 0.6 * hash(index * 7 + 4)) * (1 - 0.4 * eased),
    alpha: 0.35 + 0.5 * Math.sin(t * Math.PI),
  };
};

const dripAt = ({ source }: Feeding, index: number, nowMs: number): FeedingParticle => {
  const t = (nowMs / DRIP_FALL_MS + hash(index + 100)) % 1;
  return {
    at: {
      x: source.x + (hash(index * 5 + 101) - 0.5) * 2 * DRIP_SPREAD,
      y: source.y + t * t * DRIP_FALL,
    },
    radius: DRIP_RADIUS * (1 - 0.5 * t),
    alpha: 0.7 * (1 - t),
  };
};

/** Every fleck and drip in flight at `nowMs`: a fixed few, so the cost of a meal never grows. */
export const feedingParticles = (feeding: Feeding, nowMs: number): FeedingParticle[] => [
  ...Array.from({ length: FLECKS }, (_, index) => fleckAt(feeding, index, nowMs)),
  ...Array.from({ length: DRIPS }, (_, index) => dripAt(feeding, index, nowMs)),
];

export const paintFeeding = (
  ctx: CanvasRenderingContext2D,
  world: WorldSnapshot,
  inks: readonly InkView[],
  nowMs: number,
): void => {
  const feeding = feedingOf(world, inks);
  if (feeding === null) return;
  ctx.save();
  ctx.fillStyle = rgbCss(MARKER.black);
  for (const particle of feedingParticles(feeding, nowMs)) {
    ctx.globalAlpha = particle.alpha;
    ctx.beginPath();
    ctx.arc(particle.at.x, particle.at.y, particle.radius, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
};
