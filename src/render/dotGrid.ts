import type { Rect } from "../core/geometry";
import { TAU } from "./canvas2d";
import { BOARD_COLORS } from "./palette";

export interface DotGridLayout {
  readonly spacing: number;
  readonly firstX: number;
  readonly firstY: number;
  readonly columns: number;
  readonly rows: number;
}

export const DOT_GRID = {
  spacing: 40,
  minScreenGap: 30,
  minZoom: 0.3,
  dotScreenRadius: 1.1,
} as const;

export const dotSpacing = (zoom: number): number | null => {
  if (!(zoom >= DOT_GRID.minZoom)) return null;
  const doublings = Math.ceil(Math.log2(DOT_GRID.minScreenGap / (DOT_GRID.spacing * zoom)));
  return DOT_GRID.spacing * 2 ** Math.max(0, doublings);
};

const countFrom = (first: number, end: number, spacing: number): number =>
  Math.max(0, Math.floor((end - first) / spacing) + 1);

export const dotGridLayout = (view: Rect, zoom: number): DotGridLayout | null => {
  const spacing = dotSpacing(zoom);
  if (spacing === null) return null;
  const firstX = Math.ceil(view.x / spacing) * spacing;
  const firstY = Math.ceil(view.y / spacing) * spacing;
  return {
    spacing,
    firstX,
    firstY,
    columns: countFrom(firstX, view.x + view.width, spacing),
    rows: countFrom(firstY, view.y + view.height, spacing),
  };
};

export const paintDotGrid = (ctx: CanvasRenderingContext2D, view: Rect, zoom: number): void => {
  const layout = dotGridLayout(view, zoom);
  if (layout === null) return;
  const radius = DOT_GRID.dotScreenRadius / zoom;
  ctx.beginPath();
  for (let row = 0; row < layout.rows; row++) {
    const y = layout.firstY + row * layout.spacing;
    for (let column = 0; column < layout.columns; column++) {
      const x = layout.firstX + column * layout.spacing;
      ctx.moveTo(x + radius, y);
      ctx.arc(x, y, radius, 0, TAU);
    }
  }
  ctx.fillStyle = BOARD_COLORS.gridDot;
  ctx.fill();
};
