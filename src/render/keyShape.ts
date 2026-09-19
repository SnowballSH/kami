import type { Vec } from "../core/geometry";
import { TAU } from "./canvas2d";
import { PAGE_COLORS, PROP_COLORS } from "./palette";

const BOW = { x: -0.28, radius: 0.2 } as const;
const SHAFT_END = 0.5;
const TEETH = [0.3, 0.44] as const;
const TOOTH_DROP = 0.2;
const OUTLINE_WIDTH = 0.2;
const METAL_WIDTH = 0.1;

const traceKey = (ctx: CanvasRenderingContext2D, length: number): void => {
  ctx.beginPath();
  ctx.arc(BOW.x * length, 0, BOW.radius * length, 0, TAU);
  ctx.moveTo((BOW.x + BOW.radius) * length, 0);
  ctx.lineTo(SHAFT_END * length, 0);
  for (const tooth of TEETH) {
    ctx.moveTo(tooth * length, 0);
    ctx.lineTo(tooth * length, TOOTH_DROP * length);
  }
};

export const paintKey = (
  ctx: CanvasRenderingContext2D,
  center: Vec,
  length: number,
  angle: number,
): void => {
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(angle);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  traceKey(ctx, length);
  ctx.strokeStyle = PAGE_COLORS.printInk;
  ctx.lineWidth = OUTLINE_WIDTH * length;
  ctx.stroke();
  ctx.strokeStyle = PROP_COLORS.keyGold;
  ctx.lineWidth = METAL_WIDTH * length;
  ctx.stroke();
  ctx.restore();
};
