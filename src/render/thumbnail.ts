import { boundsOf, expandRect, type Rect } from "../core/geometry";
import { INK_THICKNESS } from "../core/world";
import type { Drawing } from "../ink/types";
import { context2d, createCanvas } from "./canvas2d";
import { inkPath } from "./inkPath";
import { FOUNTAIN_BLUE, PAGE_COLORS, rgbCss } from "./palette";
import { fitRect, type Viewport } from "./viewport";

const PADDING_RATIO = 0.12;
const MAX_MAGNIFICATION = 3;
const INK_CSS = rgbCss(FOUNTAIN_BLUE);

export const inkBounds = (drawing: Drawing): Rect | null => {
  const points = drawing.strokes.flat();
  return points.length === 0 ? null : expandRect(boundsOf(points), INK_THICKNESS / 2);
};

export const fitThumbnail = (bounds: Rect, sizePx: number): Viewport =>
  fitRect(
    bounds,
    { width: sizePx, height: sizePx },
    { padding: sizePx * PADDING_RATIO, maxScale: MAX_MAGNIFICATION },
  );

export const paintThumbnail = (drawing: Drawing, sizePx: number): HTMLCanvasElement => {
  const canvas = createCanvas({ width: sizePx, height: sizePx });
  const ctx = context2d(canvas);
  ctx.fillStyle = PAGE_COLORS.paper;
  ctx.fillRect(0, 0, sizePx, sizePx);
  const bounds = inkBounds(drawing);
  if (bounds === null) return canvas;
  const { scale, offset } = fitThumbnail(bounds, sizePx);
  ctx.setTransform(scale, 0, 0, scale, offset.x, offset.y);
  ctx.fillStyle = INK_CSS;
  ctx.fill(inkPath(drawing.strokes));
  return canvas;
};
