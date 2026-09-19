import type { Vec } from "../core/geometry";
import { TAU } from "./canvas2d";
import { BOARD_COLORS } from "./palette";

export const ERASER_RING = { screenRadius: 18, lineWidth: 1.5 } as const;

export const paintEraserRing = (ctx: CanvasRenderingContext2D, at: Vec): void => {
  ctx.beginPath();
  ctx.arc(at.x, at.y, ERASER_RING.screenRadius, 0, TAU);
  ctx.fillStyle = BOARD_COLORS.eraserVeil;
  ctx.fill();
  ctx.strokeStyle = BOARD_COLORS.eraserRing;
  ctx.lineWidth = ERASER_RING.lineWidth;
  ctx.stroke();
};
