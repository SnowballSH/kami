import type { BoardDefinition } from "../board/types";
import { distanceToRect, type Rect, type Vec } from "../core/geometry";
import type { Handwriting } from "../handwriting/types";
import type { AliceSnapshot, SumikuiSnapshot } from "../sim/types";
import { type AliceBadge, paintAlice } from "./alicePainter";
import { BoardPainter } from "./boardPainter";
import {
  paintCutMark,
  paintDimVeil,
  paintDrawnAlice,
  paintHealthBar,
  paintSnipper,
  paintSoul,
  paintTear,
  paintTelegraph,
} from "./bossPainter";
import {
  applyDeviceTransform,
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
import { paintFeeding } from "./feedingParticles";
import { InkPainter } from "./inkPainter";
import { lightsOf, NightPainter } from "./nightPainter";
import { NotePainter } from "./notePainter";
import { BOARD_COLORS } from "./palette";
import { PointerTracker } from "./pointerTracker";
import { paintSumikui } from "./sumikuiPainter";
import type { Camera, Chew, Renderer, RenderFrame } from "./types";

export const GHOST_ALPHA = 0.35;

const aliceInView = (alice: AliceSnapshot, view: Rect): boolean =>
  distanceToRect(alice.center, view) <= Math.max(alice.width, alice.height);

const chewOf = (sumikui: SumikuiSnapshot | null): Chew | null =>
  sumikui === null || sumikui.chewing === null
    ? null
    : { drawingId: sumikui.chewing, bite: sumikui.bite };

/** How far Alice has gone down its throat: she fades as it closes on her. */
const swallowOf = (sumikui: SumikuiSnapshot | null, who: number): number =>
  sumikui?.quarry === "alice" && sumikui.prey === who ? sumikui.bite : 0;

const paintHer = (
  ctx: CanvasRenderingContext2D,
  alice: AliceSnapshot,
  nowMs: number,
  badge: AliceBadge,
): void => {
  if (alice.look.kind === "drawn") paintDrawnAlice(ctx, alice, nowMs, badge);
  else paintAlice(ctx, alice, nowMs, badge);
};

const cannotSee = (alice: AliceSnapshot | null): boolean =>
  alice?.look.kind === "drawn" && !alice.look.abilities.see;

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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = BOARD_COLORS.board;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    applyDeviceTransform(ctx, transform);
    paintDotGrid(ctx, view, zoomOf(camera));
    this.boardPainter.paint(ctx, view, world);
    this.inkPainter.paintInks(ctx, frame.inks, view, nowMs, chewOf(world.sumikui));
    const moonlit = frame.daylight < 1;
    if (!moonlit) this.notePainter.paintNotes(ctx, frame.notes, view, nowMs);
    if (world.tear !== null) paintTear(ctx, world.tear, nowMs);
    this.paintGhosts(ctx, frame.ghosts ?? [], view, nowMs);
    const several = world.twins.length > 0;
    for (const [index, twin] of world.twins.entries()) {
      if (!aliceInView(twin, view)) continue;
      ctx.save();
      ctx.globalAlpha = 1 - swallowOf(world.sumikui, index + 1);
      paintHer(ctx, twin, nowMs, {
        ribbon: index + 1,
        selected: several && frame.selectedAlice === index + 1,
      });
      ctx.restore();
    }
    if (world.soul !== null) paintSoul(ctx, world.soul, nowMs);
    if (world.alice !== null && aliceInView(world.alice, view)) {
      ctx.save();
      ctx.globalAlpha = 1 - swallowOf(world.sumikui, 0);
      paintHer(ctx, world.alice, nowMs, {
        ribbon: null,
        selected: several && (frame.selectedAlice ?? 0) === 0,
      });
      ctx.restore();
    }
    if (world.sumikui !== null) {
      paintFeeding(ctx, world, frame.inks, nowMs);
      paintSumikui(ctx, world.sumikui, nowMs);
    }
    if (world.tear !== null) {
      for (const mark of world.tear.cuts) paintCutMark(ctx, mark);
      for (const snipper of world.tear.snippers) paintTelegraph(ctx, snipper);
      for (const snipper of world.tear.snippers) paintSnipper(ctx, snipper, nowMs);
    }
    this.inkPainter.paintHeld(ctx, frame.heldInks);
    this.inkPainter.paintActive(ctx, frame.activeStrokes, frame.activeVerdict);
    this.nightPainter.paint(
      ctx,
      frame.daylight,
      lightsOf(world.alice === null ? world.twins : [world.alice, ...world.twins], frame.inks),
      { width: this.canvas.width, height: this.canvas.height },
      transform,
    );
    if (moonlit) {
      applyDeviceTransform(ctx, transform);
      this.notePainter.paintNotes(ctx, frame.notes, view, nowMs, frame.daylight);
    }
    this.paintOverlay(frame);
    if (frame.eraserActive) this.paintEraserCursor();
  }

  /** Other devices' Alices on a shared page: there, but faint, so whose is whose stays clear. */
  private paintGhosts(
    ctx: CanvasRenderingContext2D,
    ghosts: readonly AliceSnapshot[],
    view: Rect,
    nowMs: number,
  ): void {
    if (ghosts.length === 0) return;
    ctx.save();
    ctx.globalAlpha = GHOST_ALPHA;
    for (const ghost of ghosts) if (aliceInView(ghost, view)) paintAlice(ctx, ghost, nowMs);
    ctx.restore();
  }

  private paintOverlay(frame: RenderFrame): void {
    const { ctx } = this;
    const { world, nowMs } = frame;
    const dim = cannotSee(world.alice);
    if (world.tear === null && !dim) return;
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    if (dim) paintDimVeil(ctx, this.box);
    if (world.tear !== null) paintHealthBar(ctx, world.tear, this.box.width, nowMs);
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
