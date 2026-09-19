import type { Rect, Vec } from "../core/geometry";
import { TAU } from "./canvas2d";
import { BOARD_COLORS } from "./palette";

const BOW = { x: -0.28, radius: 0.2 } as const;
const SHAFT_END = 0.5;
const TEETH = [0.3, 0.44] as const;
const TOOTH_DROP = 0.2;
const LINE_WIDTH = 0.085;
const REACH = 0.6;

export const keyBounds = (center: Vec, length: number): Rect => ({
  x: center.x - length * REACH,
  y: center.y - length * REACH,
  width: length * REACH * 2,
  height: length * REACH * 2,
});

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
  ctx.beginPath();
  ctx.arc(BOW.x * length, 0, BOW.radius * length, 0, TAU);
  ctx.moveTo((BOW.x + BOW.radius) * length, 0);
  ctx.lineTo(SHAFT_END * length, 0);
  for (const tooth of TEETH) {
    ctx.moveTo(tooth * length, 0);
    ctx.lineTo(tooth * length, TOOTH_DROP * length);
  }
  ctx.strokeStyle = BOARD_COLORS.marker;
  ctx.lineWidth = LINE_WIDTH * length;
  ctx.stroke();
  ctx.restore();
};
