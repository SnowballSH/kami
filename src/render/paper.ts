import { WORLD } from "../core/world";
import { TAU } from "./canvas2d";
import { PAGE_COLORS, rgbCss } from "./palette";
import { between, seededRandom } from "./random";

const PAPER_SEED = 1865;
const VIGNETTE = { innerRatio: 0.32, outerRatio: 0.78 } as const;
const FOXING = { count: 110, minRadius: 0.8, maxRadius: 6, minAlpha: 0.03, maxAlpha: 0.1 } as const;
const FIBRES = { count: 220, minLength: 6, maxLength: 26, alpha: 0.05, width: 0.6 } as const;

const paintVignette = (ctx: CanvasRenderingContext2D): void => {
  const center = { x: WORLD.width / 2, y: WORLD.height / 2 };
  const vignette = ctx.createRadialGradient(
    center.x,
    center.y,
    WORLD.width * VIGNETTE.innerRatio,
    center.x,
    center.y,
    WORLD.width * VIGNETTE.outerRatio,
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, PAGE_COLORS.paperEdge);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);
};

export const paintPaper = (ctx: CanvasRenderingContext2D): void => {
  const random = seededRandom(PAPER_SEED);
  ctx.fillStyle = PAGE_COLORS.paper;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  paintVignette(ctx);

  for (let blotch = 0; blotch < FOXING.count; blotch++) {
    ctx.fillStyle = rgbCss(PAGE_COLORS.foxing, between(random, FOXING.minAlpha, FOXING.maxAlpha));
    ctx.beginPath();
    ctx.arc(
      between(random, 0, WORLD.width),
      between(random, 0, WORLD.height),
      between(random, FOXING.minRadius, FOXING.maxRadius),
      0,
      TAU,
    );
    ctx.fill();
  }

  ctx.strokeStyle = rgbCss(PAGE_COLORS.foxing, FIBRES.alpha);
  ctx.lineWidth = FIBRES.width;
  ctx.beginPath();
  for (let fibre = 0; fibre < FIBRES.count; fibre++) {
    const x = between(random, 0, WORLD.width);
    const y = between(random, 0, WORLD.height);
    const angle = between(random, 0, TAU);
    const length = between(random, FIBRES.minLength, FIBRES.maxLength);
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
  }
  ctx.stroke();
};
