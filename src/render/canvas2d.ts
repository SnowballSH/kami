import type { Size } from "./viewport";

export const TAU = Math.PI * 2;

export const context2d = (canvas: HTMLCanvasElement): CanvasRenderingContext2D => {
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("Kami's renderer needs a 2D canvas context, and this canvas has none to give.");
  }
  return ctx;
};

export const createCanvas = ({ width, height }: Size): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

export const tracePolygon = (
  ctx: CanvasRenderingContext2D,
  points: readonly { readonly x: number; readonly y: number }[],
): void => {
  ctx.beginPath();
  for (const point of points) ctx.lineTo(point.x, point.y);
  ctx.closePath();
};
