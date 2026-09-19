import { boundsOf, type Rect, type Stroke, type Vec } from "../core/geometry";
import { INK_THICKNESS } from "../core/world";
import type { Drawing, DrawingId, PlacementVerdict } from "../ink/types";
import { awakening, inkTint, isSettled, shiverOffset } from "./awakening";
import { posedInView } from "./culling";
import { INK_PEN, strokesPath } from "./inkPath";
import { MARKER, mapNatures, NATURE_TINTS, rgbCss } from "./palette";
import type { Chew, InkView } from "./types";

interface SettledInk {
  readonly strokeCount: number;
  readonly path: Path2D;
  readonly bounds: Rect;
}

interface LiveInk {
  readonly strokeCount: number;
  readonly pointCount: number;
  readonly lastPoint: Vec | undefined;
  readonly path: Path2D;
}

const SETTLED_CSS = mapNatures((nature) => rgbCss(NATURE_TINTS[nature]));
const LIVE_CSS = rgbCss(MARKER.black);
const REJECTED_CSS = rgbCss(MARKER.red);
const SOLID_EXTRA_WIDTH = 4;
const CULL_MARGIN = INK_THICKNESS * 2;

/** The strokes still standing while the Sumikui chews: eaten from the last stroke drawn backwards. */
const uneaten = (strokes: readonly Stroke[], bite: number): Stroke[] => {
  const pointsLeft = strokes.reduce((sum, stroke) => sum + stroke.length, 0) * (1 - bite);
  const kept: Stroke[] = [];
  let budget = pointsLeft;
  for (const stroke of strokes) {
    if (budget <= 0) break;
    kept.push(budget >= stroke.length ? stroke : stroke.slice(0, Math.max(2, Math.floor(budget))));
    budget -= stroke.length;
  }
  return kept;
};

export class InkPainter {
  private readonly settled = new Map<DrawingId, SettledInk>();
  private live: LiveInk | null = null;

  forget(): void {
    this.settled.clear();
    this.live = null;
  }

  paintInks(
    ctx: CanvasRenderingContext2D,
    inks: readonly InkView[],
    view: Rect,
    nowMs: number,
    chew: Chew | null = null,
  ): void {
    for (const ink of inks) this.paintInk(ctx, ink, view, nowMs, chew);
    if (this.settled.size > inks.length) this.prune(inks);
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

  private paintInk(
    ctx: CanvasRenderingContext2D,
    ink: InkView,
    view: Rect,
    nowMs: number,
    chew: Chew | null,
  ): void {
    const settled = this.settledInk(ink.drawing);
    if (!posedInView(settled.bounds, ink.pose, view, CULL_MARGIN)) return;
    const path =
      chew?.drawingId === ink.drawing.id
        ? strokesPath(uneaten(ink.drawing.strokes, chew.bite), INK_PEN)
        : settled.path;
    const progress = awakening(nowMs, ink.awakenedAtMs);
    const awake = ink.awakenedAtMs !== null;
    const { origin, position, angle } = ink.pose;
    ctx.save();
    if (isSettled(progress)) {
      ctx.translate(position.x, position.y);
      ctx.fillStyle = awake ? SETTLED_CSS[ink.nature] : LIVE_CSS;
    } else {
      const shiver = shiverOffset(nowMs, progress);
      ctx.translate(position.x + shiver.x, position.y + shiver.y);
      ctx.fillStyle = rgbCss(inkTint(ink.nature, progress));
    }
    ctx.rotate(angle);
    ctx.translate(-origin.x, -origin.y);
    ctx.fill(path);
    if (awake && ink.nature === "solid") {
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = SOLID_EXTRA_WIDTH;
      ctx.lineJoin = "round";
      ctx.stroke(path);
    }
    ctx.restore();
  }

  private settledInk(drawing: Drawing): SettledInk {
    const cached = this.settled.get(drawing.id);
    if (cached?.strokeCount === drawing.strokes.length) return cached;
    const ink: SettledInk = {
      strokeCount: drawing.strokes.length,
      path: strokesPath(drawing.strokes, INK_PEN),
      bounds: boundsOf(drawing.strokes.flat()),
    };
    this.settled.set(drawing.id, ink);
    return ink;
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
    const path = strokesPath(strokes, INK_PEN);
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
