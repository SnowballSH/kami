import type { Pose, Stroke, Vec } from "../core/geometry";
import type { Drawing, DrawingId, PlacementVerdict } from "../ink/types";
import { awakening, inkTint, isSettled, shiverOffset } from "./awakening";
import { inkPath } from "./inkPath";
import { FOUNTAIN_BLUE, mapNatures, NATURE_TINTS, REJECTED_RED, rgbCss } from "./palette";
import type { DrawingArt, GhostInk, InkView } from "./types";

interface SettledPath {
  readonly strokeCount: number;
  readonly path: Path2D;
}

interface LivePath {
  readonly strokeCount: number;
  readonly pointCount: number;
  readonly lastPoint: Vec | undefined;
  readonly path: Path2D;
}

const SETTLED_CSS = mapNatures((nature) => rgbCss(NATURE_TINTS[nature]));
const WET_ALPHA = 0.88;
const LIVE_CSS = rgbCss(FOUNTAIN_BLUE, WET_ALPHA);
const REJECTED_CSS = rgbCss(REJECTED_RED, WET_ALPHA);
const HALO_WIDTH = 9;
const HALO_ALPHA = 0.4;

const withPose = (ctx: CanvasRenderingContext2D, pose: Pose, shiver: Vec): void => {
  const { origin, position, angle } = pose;
  ctx.translate(position.x + shiver.x, position.y + shiver.y);
  ctx.rotate(angle);
  ctx.translate(-origin.x, -origin.y);
};

const NO_SHIVER: Vec = { x: 0, y: 0 };

export class InkPainter {
  private readonly settled = new Map<DrawingId, SettledPath>();
  private readonly art = new Map<DrawingId, DrawingArt>();
  private live: LivePath | null = null;

  forget(): void {
    this.settled.clear();
    this.art.clear();
    this.live = null;
  }

  setArt(id: DrawingId, art: DrawingArt | null): void {
    if (art === null) this.art.delete(id);
    else this.art.set(id, art);
  }

  paintInks(ctx: CanvasRenderingContext2D, inks: readonly InkView[], nowMs: number): void {
    for (const ink of inks) this.paintInk(ctx, ink, nowMs);
    if (this.settled.size > inks.length) this.prune(inks);
  }

  paintGhosts(ctx: CanvasRenderingContext2D, ghosts: readonly GhostInk[], nowMs: number): void {
    for (const ghost of ghosts) {
      const alpha = 1 - (nowMs - ghost.fadeStartMs) / ghost.fadeMs;
      if (alpha <= 0) continue;
      ctx.save();
      withPose(ctx, ghost.pose, NO_SHIVER);
      ctx.fillStyle = rgbCss(FOUNTAIN_BLUE, Math.min(WET_ALPHA, alpha));
      ctx.fill(inkPath(ghost.drawing.strokes));
      ctx.restore();
    }
  }

  paintActive(
    ctx: CanvasRenderingContext2D,
    strokes: readonly Stroke[],
    verdict: PlacementVerdict,
  ): void {
    if (strokes.length === 0) {
      this.live = null;
      return;
    }
    ctx.fillStyle = verdict === "ok" ? LIVE_CSS : REJECTED_CSS;
    ctx.fill(this.livePath(strokes));
  }

  private paintInk(ctx: CanvasRenderingContext2D, ink: InkView, nowMs: number): void {
    const progress = awakening(nowMs, ink.awakenedAtMs);
    const path = this.settledPath(ink.drawing);
    const art = this.art.get(ink.drawing.id);
    ctx.save();
    withPose(ctx, ink.pose, isSettled(progress) ? NO_SHIVER : shiverOffset(nowMs, progress));
    if (art !== undefined) {
      const { x, y, width, height } = art.frame;
      ctx.drawImage(art.image, x, y, width, height);
      ctx.restore();
      return;
    }
    if (isSettled(progress)) {
      ctx.fillStyle = SETTLED_CSS[ink.nature];
    } else {
      ctx.strokeStyle = rgbCss(NATURE_TINTS[ink.nature], HALO_ALPHA * (1 - progress));
      ctx.lineWidth = HALO_WIDTH;
      ctx.lineJoin = "round";
      ctx.stroke(path);
      ctx.fillStyle = rgbCss(inkTint(ink.nature, progress));
    }
    ctx.fill(path);
    ctx.restore();
  }

  private settledPath(drawing: Drawing): Path2D {
    const cached = this.settled.get(drawing.id);
    if (cached?.strokeCount === drawing.strokes.length) return cached.path;
    const path = inkPath(drawing.strokes);
    this.settled.set(drawing.id, { strokeCount: drawing.strokes.length, path });
    return path;
  }

  private livePath(strokes: readonly Stroke[]): Path2D {
    const newest = strokes.at(-1);
    const pointCount = newest?.length ?? 0;
    const lastPoint = newest?.at(-1);
    const cached = this.live;
    if (
      cached?.strokeCount === strokes.length &&
      cached.pointCount === pointCount &&
      cached.lastPoint === lastPoint
    ) {
      return cached.path;
    }
    const path = inkPath(strokes);
    this.live = { strokeCount: strokes.length, pointCount, lastPoint, path };
    return path;
  }

  private prune(inks: readonly InkView[]): void {
    const alive = new Set(inks.map((ink) => ink.drawing.id));
    for (const id of this.settled.keys()) {
      if (!alive.has(id)) this.settled.delete(id);
    }
  }
}
