import type { Vec } from "../core/geometry";
import type { SnipperSnapshot } from "../sim/boss/snipper";
import type { CutMark, TearSnapshot } from "../sim/boss/tear";
import { TEAR_TUNING } from "../sim/boss/tuning";
import { TAU } from "./canvas2d";
import { BOARD_COLORS, MARKER, rgbCss } from "./palette";

const BLADE = { length: 2.6, width: 0.42, openAngle: 0.95, closedAngle: 0.08 } as const;
const SHIVER = { amplitude: 0.09, periodMs: 90 } as const;
const EYE = { x: 0.15, y: -0.2, radius: 0.24, pupil: 0.11 } as const;
const HURT_FLASH_MS = 220;
const CUT_DASH: readonly number[] = [9, 7];
const CUT_WIDTH = 2.4;

const RIP = { halfHeight: 62, halfWidth: 9, teeth: 7, wobble: 4.5 } as const;

const HEALTH_BAR = { width: 260, height: 14, top: 78, wobble: 1.4, lineWidth: 2.4 } as const;

const PHASE_ALPHA: Readonly<Record<SnipperSnapshot["phase"], number>> = {
  arriving: 0.55,
  circling: 0.85,
  winding: 1,
  lunging: 1,
  recovering: 0.8,
  perishing: 1,
};

const angleOf = (from: Vec, to: Vec): number => Math.atan2(to.y - from.y, to.x - from.x);

const traceBlade = (ctx: CanvasRenderingContext2D, radius: number, angle: number): void => {
  ctx.save();
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(radius * 0.2, -radius * BLADE.width);
  ctx.lineTo(radius * BLADE.length, 0);
  ctx.lineTo(radius * 0.2, radius * BLADE.width);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

/** Wide apart and quivering while it winds up; snapped shut along the cut as it lunges. */
const bladeAngle = (snipper: SnipperSnapshot, nowMs: number): number => {
  switch (snipper.phase) {
    case "winding": {
      const shiver =
        Math.sin((nowMs / SHIVER.periodMs) * TAU) * SHIVER.amplitude * snipper.progress;
      return BLADE.openAngle * (0.5 + 0.5 * snipper.progress) + shiver;
    }
    case "lunging":
      return BLADE.openAngle * (1 - snipper.progress) + BLADE.closedAngle;
    case "arriving":
    case "circling":
    case "recovering":
    case "perishing":
      return BLADE.openAngle * 0.35;
  }
};

const paintSnipperEye = (ctx: CanvasRenderingContext2D, radius: number, wide: number): void => {
  ctx.fillStyle = BOARD_COLORS.eyeWhite;
  ctx.beginPath();
  ctx.arc(radius * EYE.x, radius * EYE.y, radius * EYE.radius, 0, TAU);
  ctx.fill();
  ctx.fillStyle = rgbCss(MARKER.black);
  ctx.beginPath();
  ctx.arc(radius * EYE.x, radius * EYE.y, radius * EYE.pupil * wide, 0, TAU);
  ctx.fill();
};

/**
 * A servant of the one under the page: a dark, folded thing with two blades for arms. It faces
 * along its cut, opens the blades while it winds up, and closes them when it lunges; hurt, it
 * flashes red; perishing, it shrinks and pales like the Sumikui did.
 */
export const paintSnipper = (
  ctx: CanvasRenderingContext2D,
  snipper: SnipperSnapshot,
  nowMs: number,
): void => {
  const { radius, cut, position } = snipper;
  const perish = snipper.phase === "perishing" ? snipper.progress : 0;
  const hurt =
    snipper.hurtAgoMs !== null && snipper.hurtAgoMs < HURT_FLASH_MS
      ? 1 - snipper.hurtAgoMs / HURT_FLASH_MS
      : 0;
  const heading = cut === null ? (snipper.facing === 1 ? 0 : Math.PI) : angleOf(cut.from, cut.to);
  const size = radius * (1 - 0.7 * perish);
  ctx.save();
  ctx.translate(position.x, position.y);
  ctx.globalAlpha = PHASE_ALPHA[snipper.phase] * (1 - perish);
  ctx.rotate(heading);
  ctx.fillStyle = hurt > 0 ? rgbCss(MARKER.red, 0.6 + 0.4 * hurt) : rgbCss(MARKER.black);
  const open = bladeAngle(snipper, nowMs);
  traceBlade(ctx, size, -open);
  traceBlade(ctx, size, open);
  ctx.beginPath();
  ctx.moveTo(size * 0.6, 0);
  ctx.lineTo(0, -size * 0.85);
  ctx.lineTo(-size, 0);
  ctx.lineTo(0, size * 0.85);
  ctx.closePath();
  ctx.fill();
  paintSnipperEye(ctx, size, snipper.phase === "winding" ? 1 + snipper.progress : 1);
  ctx.restore();
};

/** The line the blades will close along: a faint dashed warning while it winds up. */
export const paintTelegraph = (ctx: CanvasRenderingContext2D, snipper: SnipperSnapshot): void => {
  if (snipper.cut === null || snipper.phase !== "winding") return;
  ctx.save();
  ctx.strokeStyle = rgbCss(MARKER.red, 0.25 + 0.55 * snipper.progress);
  ctx.lineWidth = CUT_WIDTH;
  ctx.setLineDash(CUT_DASH);
  ctx.lineDashOffset = -snipper.progress * 40;
  ctx.beginPath();
  ctx.moveTo(snipper.cut.from.x, snipper.cut.from.y);
  ctx.lineTo(snipper.cut.to.x, snipper.cut.to.y);
  ctx.stroke();
  ctx.restore();
};

/** Where a snip fell: red if it took ink, grey if it only cut paper; fades in a moment. */
export const paintCutMark = (ctx: CanvasRenderingContext2D, mark: CutMark): void => {
  const fade = 1 - mark.ageMs / TEAR_TUNING.cutFlashMs;
  if (fade <= 0) return;
  ctx.save();
  ctx.strokeStyle = mark.landed ? rgbCss(MARKER.red, fade) : rgbCss(MARKER.black, 0.4 * fade);
  ctx.lineWidth = CUT_WIDTH * (mark.landed ? 1.4 : 1);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(mark.cut.from.x, mark.cut.from.y);
  ctx.lineTo(mark.cut.to.x, mark.cut.to.y);
  ctx.stroke();
  ctx.restore();
};

const tearWidth = (tear: TearSnapshot): number => {
  switch (tear.phase) {
    case "opening":
      return tear.progress;
    case "open":
      return 1;
    case "closing":
      return 1 - tear.progress;
    case "closed":
      return 0;
  }
};

/** The rip in the page: a jagged dark seam that widens as it opens and knits shut as it closes. */
export const paintTear = (
  ctx: CanvasRenderingContext2D,
  tear: TearSnapshot,
  nowMs: number,
): void => {
  const width = tearWidth(tear);
  if (width <= 0) return;
  ctx.save();
  ctx.translate(tear.at.x, tear.at.y);
  ctx.fillStyle = rgbCss(MARKER.black, 0.9);
  ctx.beginPath();
  for (let side = -1; side <= 1; side += 2) {
    for (let tooth = 0; tooth <= RIP.teeth; tooth++) {
      const t = tooth / RIP.teeth;
      const y = side * (t * 2 - 1) * RIP.halfHeight;
      const bulge = Math.sin(t * Math.PI);
      const wobble = Math.sin(nowMs / 230 + tooth * 2.1 + side) * RIP.wobble;
      const x = side * (RIP.halfWidth * bulge * width + wobble * bulge * width);
      if (side === -1 && tooth === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

/** The servant's health, drawn in ink at the top of the screen (screen space, CSS px). */
export const paintHealthBar = (
  ctx: CanvasRenderingContext2D,
  tear: TearSnapshot,
  viewportWidth: number,
  nowMs: number,
): void => {
  if (tear.phase === "closed") return;
  const left = (viewportWidth - HEALTH_BAR.width) / 2;
  const { top, height, width } = HEALTH_BAR;
  const wobble = (seed: number): number => Math.sin(nowMs / 900 + seed) * HEALTH_BAR.wobble;
  ctx.save();
  ctx.strokeStyle = rgbCss(MARKER.black);
  ctx.lineWidth = HEALTH_BAR.lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(left + wobble(0), top + wobble(1));
  ctx.lineTo(left + width + wobble(2), top + wobble(3));
  ctx.lineTo(left + width + wobble(4), top + height + wobble(5));
  ctx.lineTo(left + wobble(6), top + height + wobble(7));
  ctx.closePath();
  ctx.stroke();
  const filled = Math.max(0, Math.min(1, tear.health)) * (width - 6);
  ctx.fillStyle = rgbCss(tear.health > 0.3 ? MARKER.black : MARKER.red, 0.85);
  ctx.fillRect(left + 3, top + 3, filled, height - 6);
  ctx.restore();
};
