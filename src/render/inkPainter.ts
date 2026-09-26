import { boundsOf, type Rect, type Stroke, type Vec } from "../core/geometry";
import { INK_THICKNESS } from "../core/world";
import type { Drawing, DrawingId, PlacementVerdict } from "../ink/types";
import type { SimEvent } from "../sim/types";
import { motionAllowed } from "./animation/motion";
import { awakening, inkTint, isSettled, shiverOffset } from "./awakening";
import { posedInView } from "./culling";
import { INK_PEN, strokesPath } from "./inkPath";
import { MARKER, mapNatures, NATURE_TINTS, rgbCss } from "./palette";
import type { Chew, HeldInkView, InkView } from "./types";

interface SettledInk {
  readonly strokes: Drawing["strokes"];
  readonly bounds: Rect;
  path: Path2D | null;
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
  private readonly portalPulses = new Map<DrawingId, number>();
  private readonly held = new WeakMap<readonly Stroke[], Path2D>();
  private live: LiveInk | null = null;

  forget(): void {
    this.settled.clear();
    this.portalPulses.clear();
    this.live = null;
  }

  paintInks(
    ctx: CanvasRenderingContext2D,
    inks: readonly InkView[],
    view: Rect,
    nowMs: number,
    chew: Chew | null = null,
    events: readonly SimEvent[] = [],
  ): void {
    for (const event of events) {
      if (event.type === "warped") {
        this.portalPulses.set(event.from, nowMs);
        this.portalPulses.set(event.to, nowMs);
      }
    }
    for (const ink of inks) this.paintInk(ctx, ink, view, nowMs, chew);
    for (const [id, startedAt] of this.portalPulses) {
      if (nowMs - startedAt > 400) this.portalPulses.delete(id);
    }
  }

  /** One ink painted again on top of the rest, as a ridden vehicle is over its rider. */
  paintOver(ctx: CanvasRenderingContext2D, ink: InkView, view: Rect, nowMs: number): void {
    this.paintInk(ctx, ink, view, nowMs, null);
  }

  /** Forgets every cached ink but those still on the board. */
  retain(alive: ReadonlySet<DrawingId>): void {
    for (const id of this.settled.keys()) {
      if (!alive.has(id)) this.settled.delete(id);
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
    ctx.fillStyle = verdict === "ok" || verdict === "under-ground" ? LIVE_CSS : REJECTED_CSS;
    ctx.fill(this.livePath(strokes));
  }

  paintHeld(ctx: CanvasRenderingContext2D, held: readonly HeldInkView[]): void {
    if (held.length === 0) return;
    ctx.save();
    ctx.fillStyle = LIVE_CSS;
    for (const { strokes, opacity } of held) {
      ctx.globalAlpha = opacity;
      ctx.fill(this.heldPath(strokes));
    }
    ctx.restore();
  }

  private heldPath(strokes: readonly Stroke[]): Path2D {
    const cached = this.held.get(strokes);
    if (cached !== undefined) return cached;
    const path = strokesPath(strokes, INK_PEN);
    this.held.set(strokes, path);
    return path;
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
        : this.pathOf(settled);
    const progress = awakening(nowMs, ink.awakenedAtMs);
    const awake = ink.awakenedAtMs !== null;
    const { origin, position, angle, scale } = ink.pose;
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
    ctx.scale(scale, scale);
    ctx.translate(-origin.x, -origin.y);
    ctx.fill(path);
    if (awake && ink.nature === "solid") {
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = SOLID_EXTRA_WIDTH;
      ctx.lineJoin = "round";
      ctx.stroke(path);
    }
    this.paintPortalPulse(ctx, ink, settled.bounds, path, nowMs);
    ctx.restore();
  }

  private paintPortalPulse(
    ctx: CanvasRenderingContext2D,
    ink: InkView,
    bounds: Rect,
    path: Path2D,
    nowMs: number,
  ): void {
    const startedAt = this.portalPulses.get(ink.drawing.id);
    if (!motionAllowed() || ink.nature !== "portal" || startedAt === undefined) return;
    const progress = Math.max(0, Math.min(1, (nowMs - startedAt) / 400));
    const pulse = Math.sin(Math.PI * progress);
    if (pulse <= 0) return;
    ctx.save();
    ctx.translate(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    ctx.scale(1 + pulse * 0.15, 1 + pulse * 0.15);
    ctx.translate(-(bounds.x + bounds.width / 2), -(bounds.y + bounds.height / 2));
    ctx.globalAlpha = pulse * 0.7;
    ctx.strokeStyle = SETTLED_CSS[ink.nature];
    ctx.lineWidth = 3 + pulse * 4;
    ctx.stroke(path);
    ctx.restore();
  }

  private settledInk(drawing: Drawing): SettledInk {
    const cached = this.settled.get(drawing.id);
    if (cached?.strokes === drawing.strokes) return cached;
    const ink: SettledInk = {
      strokes: drawing.strokes,
      bounds: boundsOf(drawing.strokes.flat()),
      path: null,
    };
    this.settled.set(drawing.id, ink);
    return ink;
  }

  private pathOf(settled: SettledInk): Path2D {
    settled.path ??= strokesPath(settled.strokes, INK_PEN);
    return settled.path;
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
}
