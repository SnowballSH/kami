import type { Vec } from "../core/geometry";
import type { DrawnBody } from "../sim/body/types";
import { BODY_TUNING } from "../sim/boss/tuning";
import { ALICE_BASE, type AliceSnapshot, type SoulSnapshot } from "../sim/types";
import { type AliceBadge, HERSELF, paintBadge } from "./alicePainter";
import { TAU } from "./canvas2d";
import { INK_PEN, strokesPath } from "./inkPath";
import { MARKER, rgbCss } from "./palette";

const SOUL = { radius: BODY_TUNING.heartRadius, glow: 4.2, pulseMs: 1_500 } as const;
const GLOW_PEN = { ...INK_PEN, size: INK_PEN.size * 3.4 };
const GLOW_MAX_ALPHA = 0.55;

const bodyPaths = new WeakMap<DrawnBody["strokes"], Path2D>();

const bodyPath = (strokes: DrawnBody["strokes"]): Path2D => {
  const cached = bodyPaths.get(strokes);
  if (cached !== undefined) return cached;
  const path = strokesPath(
    strokes.map(({ stroke }) => stroke),
    INK_PEN,
  );
  bodyPaths.set(strokes, path);
  return path;
};

/** The heart alone: a small pulse of blue ink waiting for a body to be drawn around it. */
export const paintSoul = (
  ctx: CanvasRenderingContext2D,
  soul: SoulSnapshot,
  nowMs: number,
): void => {
  const pulse = 0.5 + 0.5 * Math.sin((nowMs / SOUL.pulseMs) * TAU);
  const radius = SOUL.radius * (1 + 0.12 * pulse);
  ctx.save();
  ctx.translate(soul.at.x, soul.at.y);
  const halo = ctx.createRadialGradient(0, 0, radius * 0.4, 0, 0, radius * SOUL.glow);
  halo.addColorStop(0, rgbCss(MARKER.blue, 0.35 + 0.2 * pulse));
  halo.addColorStop(1, rgbCss(MARKER.blue, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, radius * SOUL.glow, 0, TAU);
  ctx.fill();
  ctx.fillStyle = rgbCss(MARKER.blue);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.fill();
  ctx.fillStyle = rgbCss([255, 255, 255], 0.85);
  ctx.beginPath();
  ctx.arc(-radius * 0.3, -radius * 0.3, radius * 0.28, 0, TAU);
  ctx.fill();
  ctx.restore();
};

const paintHeart = (ctx: CanvasRenderingContext2D, heart: Vec, nowMs: number): void => {
  const pulse = 0.5 + 0.5 * Math.sin((nowMs / SOUL.pulseMs) * TAU);
  ctx.fillStyle = rgbCss(MARKER.blue, 0.75 + 0.25 * pulse);
  ctx.beginPath();
  ctx.arc(heart.x, heart.y, SOUL.radius * 0.7, 0, TAU);
  ctx.fill();
};

/**
 * A body made of the player's own strokes, painted in body space: strokes drawn onto her recently
 * glow blue for a moment so the drawer sees the graft take.
 */
export const paintDrawnAlice = (
  ctx: CanvasRenderingContext2D,
  alice: AliceSnapshot,
  nowMs: number,
  badge: AliceBadge = HERSELF,
): void => {
  if (alice.look.kind !== "drawn") return;
  const { body, scale, clockMs } = alice.look;
  ctx.save();
  ctx.translate(alice.center.x, alice.center.y);
  ctx.scale(alice.height / ALICE_BASE.height, alice.height / ALICE_BASE.height);
  paintBadge(ctx, 1, badge);
  ctx.restore();
  ctx.save();
  ctx.translate(alice.center.x, alice.center.y);
  ctx.scale(alice.facing * scale, scale);
  for (const { stroke, sinceMs } of body.strokes) {
    const fresh = 1 - (clockMs - sinceMs) / BODY_TUNING.graftGlowMs;
    if (fresh <= 0) continue;
    ctx.fillStyle = rgbCss(MARKER.blue, GLOW_MAX_ALPHA * fresh);
    ctx.fill(strokesPath([stroke], GLOW_PEN));
  }
  ctx.fillStyle = rgbCss(MARKER.black);
  ctx.fill(bodyPath(body.strokes));
  paintHeart(ctx, body.heart, nowMs);
  ctx.restore();
};

/** Losing the head dims the page: the body cannot see, so neither do the players, quite. */
export const paintDimVeil = (
  ctx: CanvasRenderingContext2D,
  viewport: { readonly width: number; readonly height: number },
): void => {
  const { width, height } = viewport;
  const veil = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.2,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.7,
  );
  veil.addColorStop(0, rgbCss(MARKER.black, 0.1));
  veil.addColorStop(1, rgbCss(MARKER.black, 0.7));
  ctx.save();
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
};
