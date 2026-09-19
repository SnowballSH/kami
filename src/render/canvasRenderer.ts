import type { BoardDefinition } from "../board/types";
import { distanceToRect, type Rect, type Vec } from "../core/geometry";
import type { Handwriting } from "../handwriting/types";
import type { AliceSnapshot, SumikuiSnapshot } from "../sim/types";
import { paintAlice } from "./alicePainter";
import { BoardPainter } from "./boardPainter";
import {
  backingStoreSize,
  cappedPixelRatio,
  deviceTransform,
  type Size,
  toWorld,
  visibleWorld,
  zoomOf,
} from "./camera";
import { context2d } from "./canvas2d";
import { paintDotGrid } from "./dotGrid";
import { paintEraserRing } from "./eraserRing";
import { InkPainter } from "./inkPainter";
import { lightsOf, NightPainter } from "./nightPainter";
import { NotePainter } from "./notePainter";
import { BOARD_COLORS } from "./palette";
import { PointerTracker } from "./pointerTracker";
import { paintSumikui } from "./sumikuiPainter";
import type { Camera, Chew, Renderer, RenderFrame } from "./types";

const aliceInView = (alice: AliceSnapshot, view: Rect): boolean =>
  distanceToRect(alice.center, view) <= Math.max(alice.width, alice.height);

const chewOf = (sumikui: SumikuiSnapshot | null): Chew | null =>
  sumikui === null || sumikui.chewing === null
    ? null
    : { drawingId: sumikui.chewing, bite: sumikui.bite };

/** How far Alice has gone down its throat: she fades as it closes on her. */
const swallowOf = (sumikui: SumikuiSnapshot | null): number =>
  sumikui?.quarry === "alice" ? sumikui.bite : 0;

export class CanvasRenderer implements Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly boardPainter = new BoardPainter();
  private readonly inkPainter = new InkPainter();
  private readonly notePainter: NotePainter;
  private readonly nightPainter = new NightPainter();
  private readonly pointer: PointerTracker;
  private box: Size = { width: 0, height: 0 };
  private pixelRatio = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    handwriting: Handwriting,
  ) {
    this.ctx = context2d(canvas);
    this.notePainter = new NotePainter(handwriting);
    this.pointer = new PointerTracker(canvas);
    this.resize();
  }

  setBoard(board: BoardDefinition): void {
    this.boardPainter.setBoard(board);
    this.inkPainter.forget();
    this.notePainter.forget();
  }

  resize(): void {
    this.pixelRatio = cappedPixelRatio(globalThis.devicePixelRatio);
    this.box = { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
    const store = backingStoreSize(this.box, this.pixelRatio);
    if (this.canvas.width !== store.width) this.canvas.width = store.width;
    if (this.canvas.height !== store.height) this.canvas.height = store.height;
  }

  toWorld(client: Vec, camera: Camera): Vec {
    this.refitIfBoxChanged();
    return toWorld(this.toCanvas(client), camera, this.box);
  }

  viewport(): Size {
    this.refitIfBoxChanged();
    return this.box;
  }

  render(frame: RenderFrame): void {
    this.refitIfBoxChanged();
    const { ctx } = this;
    const { camera, world, nowMs } = frame;
    const view = visibleWorld(camera, this.box);
    const transform = deviceTransform(camera, this.box, this.pixelRatio);
    const { scale, dx, dy } = transform;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = BOARD_COLORS.board;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(scale, 0, 0, scale, dx, dy);
    paintDotGrid(ctx, view, zoomOf(camera));
    this.boardPainter.paint(ctx, view, world);
    this.inkPainter.paintInks(ctx, frame.inks, view, nowMs, chewOf(world.sumikui));
    const moonlit = frame.daylight < 1;
    if (!moonlit) this.notePainter.paintNotes(ctx, frame.notes, view, nowMs);
    for (const twin of world.twins) if (aliceInView(twin, view)) paintAlice(ctx, twin, nowMs);
    if (aliceInView(world.alice, view)) {
      ctx.save();
      ctx.globalAlpha = 1 - swallowOf(world.sumikui);
      paintAlice(ctx, world.alice, nowMs);
      ctx.restore();
    }
    if (world.sumikui !== null) paintSumikui(ctx, world.sumikui, nowMs);
    this.inkPainter.paintActive(ctx, frame.activeStrokes, frame.activeVerdict);
    this.nightPainter.paint(
      ctx,
      frame.daylight,
      lightsOf([world.alice, ...world.twins], frame.inks),
      { width: this.canvas.width, height: this.canvas.height },
      transform,
    );
    if (moonlit) {
      ctx.setTransform(scale, 0, 0, scale, dx, dy);
      this.notePainter.paintNotes(ctx, frame.notes, view, nowMs, frame.daylight);
    }
    if (frame.eraserActive) this.paintEraserCursor();
  }

  private paintEraserCursor(): void {
    const client = this.pointer.client;
    if (client === null) return;
    this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    paintEraserRing(this.ctx, this.toCanvas(client));
  }

  private toCanvas(client: Vec): Vec {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: client.x - bounds.left - this.canvas.clientLeft,
      y: client.y - bounds.top - this.canvas.clientTop,
    };
  }

  private refitIfBoxChanged(): void {
    const { clientWidth, clientHeight } = this.canvas;
    if (clientWidth !== this.box.width || clientHeight !== this.box.height) this.resize();
  }
}
