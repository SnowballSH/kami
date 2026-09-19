import type { Vec } from "../core/geometry";
import { WORLD } from "../core/world";
import type { LevelDefinition } from "../game/types";
import type { Drawing, DrawingId } from "../ink/types";
import { paintAlice } from "./alicePainter";
import { context2d } from "./canvas2d";
import { Effects } from "./effects";
import { InkPainter } from "./inkPainter";
import { Page } from "./page";
import { PAGE_COLORS } from "./palette";
import { PropsPainter } from "./propsPainter";
import { paintThumbnail } from "./thumbnail";
import type { DrawingArt, Renderer, RenderFrame } from "./types";
import {
  backingStoreSize,
  cappedPixelRatio,
  type DeviceTransform,
  deviceTransform,
  fitViewport,
  type Size,
  toWorld,
  type Viewport,
} from "./viewport";

const UNDER_PAGE_STEP_PX = 4;
const UNDER_PAGE_COUNT = 2;

export class CanvasRenderer implements Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly inkPainter = new InkPainter();
  private readonly propsPainter: PropsPainter;
  private readonly effects: Effects;
  private level: LevelDefinition | null = null;
  private page: Page | null = null;
  private box: Size = { width: 0, height: 0 };
  private viewport: Viewport = fitViewport(WORLD);
  private transform: DeviceTransform = deviceTransform(this.viewport, 1);

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = context2d(canvas);
    this.propsPainter = new PropsPainter(this.ctx);
    this.effects = new Effects(this.ctx);
    this.resize();
  }

  setLevel(level: LevelDefinition): void {
    this.level = level;
    this.page = new Page(level);
    this.page.rasterize(this.transform.scale);
    this.propsPainter.setLevel(level);
    this.inkPainter.forget();
  }

  resize(): void {
    const pixelRatio = cappedPixelRatio(globalThis.devicePixelRatio);
    this.box = { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
    this.viewport = fitViewport(this.box);
    this.transform = deviceTransform(this.viewport, pixelRatio);
    const store = backingStoreSize(this.box, pixelRatio);
    if (this.canvas.width !== store.width) this.canvas.width = store.width;
    if (this.canvas.height !== store.height) this.canvas.height = store.height;
    this.page?.rasterize(this.transform.scale);
  }

  toWorld(clientX: number, clientY: number): Vec {
    this.refitIfBoxChanged();
    const bounds = this.canvas.getBoundingClientRect();
    return toWorld(this.viewport, {
      x: clientX - bounds.left - this.canvas.clientLeft,
      y: clientY - bounds.top - this.canvas.clientTop,
    });
  }

  render(frame: RenderFrame): void {
    this.refitIfBoxChanged();
    const { ctx } = this;
    const { scale, dx, dy } = this.transform;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAGE_COLORS.desk;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(scale, 0, 0, scale, dx, dy);
    this.paintUnderPages();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, WORLD.width, WORLD.height);
    ctx.clip();
    this.paintPage();
    if (this.level !== null) this.propsPainter.paint(this.level, frame.world, frame.nowMs);
    this.inkPainter.paintInks(ctx, frame.inks, frame.nowMs);
    this.inkPainter.paintGhosts(ctx, frame.ghosts, frame.nowMs);
    paintAlice(ctx, frame.world.alice, frame.nowMs, frame.aliceWaiting);
    this.inkPainter.paintActive(ctx, frame.activeStrokes, frame.activeVerdict);
    this.effects.paint(frame.nowMs, frame.bulletTime, frame.eraserActive);
    ctx.restore();
  }

  thumbnail(drawing: Drawing, sizePx: number): HTMLCanvasElement {
    return paintThumbnail(drawing, sizePx);
  }

  setArt(id: DrawingId, art: DrawingArt | null): void {
    this.inkPainter.setArt(id, art);
  }

  private refitIfBoxChanged(): void {
    const { clientWidth, clientHeight } = this.canvas;
    if (clientWidth !== this.box.width || clientHeight !== this.box.height) this.resize();
  }

  private paintUnderPages(): void {
    this.ctx.fillStyle = PAGE_COLORS.underPage;
    for (let depth = UNDER_PAGE_COUNT; depth > 0; depth--) {
      const shift = depth * UNDER_PAGE_STEP_PX;
      this.ctx.fillRect(shift, shift, WORLD.width, WORLD.height);
    }
  }

  private paintPage(): void {
    if (this.page === null) {
      this.ctx.fillStyle = PAGE_COLORS.paper;
      this.ctx.fillRect(0, 0, WORLD.width, WORLD.height);
      return;
    }
    this.ctx.drawImage(this.page.image, 0, 0, WORLD.width, WORLD.height);
  }
}
