import { clamp } from "../core/geometry";
import { WORLD } from "../core/world";
import { EFFECT_COLORS, rgbCss } from "./palette";

const BULLET_TIME = { fadeMs: 220, innerRatio: 0.3, outerRatio: 0.72, edgeAlpha: 0.42 } as const;
const ERASER = { borderWidth: 6, dash: [18, 12] } as const;
const ERASER_WASH_CSS = rgbCss(EFFECT_COLORS.eraser, 0.07);
const ERASER_BORDER_CSS = rgbCss(EFFECT_COLORS.eraser, 0.55);

export const easeToward = (
  current: number,
  target: number,
  elapsedMs: number,
  fadeMs: number,
): number => {
  const step = Math.max(elapsedMs, 0) / fadeMs;
  return clamp(target, current - step, current + step);
};

export class Effects {
  private readonly vignette: CanvasGradient;
  private bulletTime = 0;
  private lastMs: number | null = null;

  constructor(private readonly ctx: CanvasRenderingContext2D) {
    const center = { x: WORLD.width / 2, y: WORLD.height / 2 };
    this.vignette = ctx.createRadialGradient(
      center.x,
      center.y,
      WORLD.width * BULLET_TIME.innerRatio,
      center.x,
      center.y,
      WORLD.width * BULLET_TIME.outerRatio,
    );
    this.vignette.addColorStop(0, rgbCss(EFFECT_COLORS.bulletTime, 0));
    this.vignette.addColorStop(1, rgbCss(EFFECT_COLORS.bulletTime, BULLET_TIME.edgeAlpha));
  }

  paint(nowMs: number, bulletTime: boolean, eraserActive: boolean): void {
    const elapsedMs = this.lastMs === null ? 0 : nowMs - this.lastMs;
    this.lastMs = nowMs;
    this.bulletTime = easeToward(
      this.bulletTime,
      bulletTime ? 1 : 0,
      elapsedMs,
      BULLET_TIME.fadeMs,
    );
    if (eraserActive) this.paintEraserTint();
    if (this.bulletTime > 0) this.paintVignette();
  }

  private paintVignette(): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = this.bulletTime;
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    ctx.restore();
  }

  private paintEraserTint(): void {
    const { ctx } = this;
    const inset = ERASER.borderWidth / 2;
    ctx.save();
    ctx.fillStyle = ERASER_WASH_CSS;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    ctx.strokeStyle = ERASER_BORDER_CSS;
    ctx.lineWidth = ERASER.borderWidth;
    ctx.setLineDash(ERASER.dash);
    ctx.strokeRect(inset, inset, WORLD.width - inset * 2, WORLD.height - inset * 2);
    ctx.restore();
  }
}
