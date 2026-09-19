import { expandRect, type Rect, rectCenter, type Vec } from "../core/geometry";
import { TAU, tracePolygon } from "./canvas2d";
import { PAGE_COLORS } from "./palette";
import { between, type Random, seededRandom } from "./random";

const HOLE_SEED = 1871;
const VERTEX_COUNT = 30;
const MIN_REACH = 0.78;
const TORN_RIM_PX = 7;
const RIM_LINE_WIDTH = 1.2;

export const raggedOutline = (rect: Rect, random: Random): readonly Vec[] => {
  const center = rectCenter(rect);
  return Array.from({ length: VERTEX_COUNT }, (_, index) => {
    const angle = (index / VERTEX_COUNT) * TAU;
    const reach = between(random, MIN_REACH, 1);
    return {
      x: center.x + (Math.cos(angle) * reach * rect.width) / 2,
      y: center.y + (Math.sin(angle) * reach * rect.height) / 2,
    };
  });
};

export const paintExitHole = (ctx: CanvasRenderingContext2D, exit: Rect): void => {
  const random = seededRandom(HOLE_SEED);
  ctx.save();
  ctx.lineJoin = "round";
  tracePolygon(ctx, raggedOutline(exit, random));
  ctx.fillStyle = PAGE_COLORS.tornEdge;
  ctx.fill();
  ctx.strokeStyle = PAGE_COLORS.printInk;
  ctx.lineWidth = RIM_LINE_WIDTH;
  ctx.stroke();
  tracePolygon(ctx, raggedOutline(expandRect(exit, -TORN_RIM_PX), random));
  ctx.fillStyle = PAGE_COLORS.holeDark;
  ctx.fill();
  ctx.restore();
};
