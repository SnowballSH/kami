import type { Vec } from "../core/geometry";
import type { SumikuiPhase, SumikuiQuarry, SumikuiSnapshot } from "../sim/types";
import { TAU } from "./canvas2d";
import { MARKER, rgbCss } from "./palette";

const BODY_RADIUS = 22;
const LOBES = 7;
const LOBE_WOBBLE = 0.22;
const BREATH_PERIOD_MS = 1_700;
const EYE = { x: 6, y: -3, radius: 5.5, pupil: 2.2 } as const;
const DRIPS = 4;
const DRIP_PERIOD_MS = 1_300;
const DRIP_FALL = 34;
const DRIP_RADIUS = 2.6;
const HALO_FADE_MS = 30_000;
const HALO_MAX_ALPHA = 0.28;

const PHASE_ALPHA: Readonly<Record<SumikuiPhase, number>> = {
  stirring: 0.35,
  prowling: 0.8,
  hunting: 0.95,
  feeding: 1,
  sated: 0.55,
};
const QUARRY_PUPIL: Readonly<Record<SumikuiQuarry, number>> = { ink: 1, paper: 1.2, alice: 1.7 };

const PHASE_EYE_SQUINT: Readonly<Record<SumikuiPhase, number>> = {
  stirring: 0.25,
  prowling: 0.7,
  hunting: 1,
  feeding: 0.45,
  sated: 0.15,
};

const lobeRadius = (index: number, nowMs: number, bite: number): number => {
  const breath = Math.sin((nowMs / BREATH_PERIOD_MS) * TAU + index * 1.9);
  return BODY_RADIUS * (1 + LOBE_WOBBLE * breath) * (1 + 0.25 * bite);
};

const traceBlot = (ctx: CanvasRenderingContext2D, nowMs: number, bite: number): void => {
  ctx.beginPath();
  for (let index = 0; index <= LOBES; index++) {
    const angle = (index / LOBES) * TAU;
    const radius = lobeRadius(index % LOBES, nowMs, bite);
    const point: Vec = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    if (index === 0) ctx.moveTo(point.x, point.y);
    else {
      const previousAngle = ((index - 1) / LOBES) * TAU;
      const previousRadius = lobeRadius((index - 1) % LOBES, nowMs, bite);
      const midAngle = (previousAngle + angle) / 2;
      const midRadius = ((previousRadius + radius) / 2) * 1.12;
      ctx.quadraticCurveTo(
        Math.cos(midAngle) * midRadius,
        Math.sin(midAngle) * midRadius,
        point.x,
        point.y,
      );
    }
  }
  ctx.closePath();
};

const paintDrips = (ctx: CanvasRenderingContext2D, nowMs: number, alpha: number): void => {
  for (let index = 0; index < DRIPS; index++) {
    const phase = (((nowMs / DRIP_PERIOD_MS + index / DRIPS) % 1) + 1) % 1;
    const x = (index - (DRIPS - 1) / 2) * 9;
    const y = BODY_RADIUS * 0.6 + phase * DRIP_FALL;
    ctx.globalAlpha = alpha * (1 - phase);
    ctx.beginPath();
    ctx.arc(x, y, DRIP_RADIUS * (1 - phase * 0.5), 0, TAU);
    ctx.fill();
  }
};

/** The pupil widens with what it wants: a drawing, the ground under her, or her. */
const paintEye = (ctx: CanvasRenderingContext2D, squint: number, pupil: number): void => {
  ctx.save();
  ctx.translate(EYE.x, EYE.y);
  ctx.scale(1, Math.max(squint, 0.08));
  ctx.fillStyle = "#f4f1ea";
  ctx.beginPath();
  ctx.arc(0, 0, EYE.radius, 0, TAU);
  ctx.fill();
  ctx.fillStyle = rgbCss(MARKER.black);
  ctx.beginPath();
  ctx.arc(1.2, 0, EYE.pupil * pupil, 0, TAU);
  ctx.fill();
  ctx.restore();
};

/** A pale halo that darkens as it has been awake longer: the older the hunger, the wider it reaches. */
const paintHalo = (ctx: CanvasRenderingContext2D, awakeMs: number): void => {
  const strength = Math.min(awakeMs / HALO_FADE_MS, 1);
  if (strength <= 0) return;
  const radius = BODY_RADIUS * (1.8 + strength);
  const halo = ctx.createRadialGradient(0, 0, BODY_RADIUS * 0.6, 0, 0, radius);
  halo.addColorStop(0, rgbCss(MARKER.black, HALO_MAX_ALPHA * strength));
  halo.addColorStop(1, rgbCss(MARKER.black, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.fill();
};

export const paintSumikui = (
  ctx: CanvasRenderingContext2D,
  sumikui: SumikuiSnapshot,
  nowMs: number,
): void => {
  const alpha = PHASE_ALPHA[sumikui.phase];
  ctx.save();
  ctx.translate(sumikui.centre.x, sumikui.centre.y);
  paintHalo(ctx, sumikui.awakeMs);
  ctx.fillStyle = rgbCss(MARKER.black);
  paintDrips(ctx, nowMs, alpha);
  ctx.globalAlpha = alpha;
  traceBlot(ctx, nowMs, sumikui.bite);
  ctx.fill();
  ctx.scale(sumikui.facing, 1);
  const pupil = sumikui.quarry === null ? 1 : QUARRY_PUPIL[sumikui.quarry];
  paintEye(ctx, PHASE_EYE_SQUINT[sumikui.phase], pupil);
  ctx.restore();
};
