import { clamp, distance, type Vec } from "../core/geometry";
import type { CanvasInputSink, Tool } from "./types";

export type PointerKind = "mouse" | "pen" | "touch";

export interface PointerPress {
  readonly id: number;
  readonly kind: PointerKind;
  readonly client: Vec;
  readonly button: number;
}

export interface WheelTurn {
  readonly client: Vec;
  readonly delta: Vec;
  readonly zooming: boolean;
}

export const TAP_SLOP_PX = 6;
export const WHEEL_ZOOM_RATE = 0.01;
export const WHEEL_ZOOM_MAX_DELTA = 40;

const PRIMARY_BUTTON = 0;
const MIDDLE_BUTTON = 1;
const MIN_PINCH_SPAN_PX = 1;

type DragMode = "ink" | "pan" | "tap";

interface Drag {
  readonly pointerId: number;
  readonly kind: PointerKind;
  readonly mode: DragMode;
  readonly start: Vec;
  last: Vec;
  travelled: boolean;
}

interface PinchAnchor {
  readonly midpoint: Vec;
  readonly span: number;
}

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "drag"; readonly drag: Drag }
  | { readonly kind: "pinch"; anchor: PinchAnchor }
  | { readonly kind: "settling" };

const IDLE: Phase = { kind: "idle" };
const SETTLING: Phase = { kind: "settling" };

const MODE_BY_TOOL: Readonly<Record<Tool, DragMode>> = {
  draw: "ink",
  erase: "ink",
  pan: "pan",
  write: "tap",
};

const subtract = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });

const isZero = (v: Vec): boolean => v.x === 0 && v.y === 0;

const pinchAnchorOf = (touches: ReadonlyMap<number, Vec>): PinchAnchor | null => {
  const [first, second] = [...touches.values()];
  if (first === undefined || second === undefined) return null;
  return {
    midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    span: distance(first, second),
  };
};

/**
 * Decides what pointers on the board mean. One pointer is a stroke, a pan or a tap depending on
 * the tool when it landed; two fingers pan and pinch until every finger has lifted; a pencil
 * outranks fingers, so a resting palm never draws and never blocks the pencil.
 */
export class GestureMachine {
  private readonly currentTool: () => Tool;
  private readonly sink: CanvasInputSink;
  private readonly touches = new Map<number, Vec>();
  private phase: Phase = IDLE;

  constructor(currentTool: () => Tool, sink: CanvasInputSink) {
    this.currentTool = currentTool;
    this.sink = sink;
  }

  press(pointer: PointerPress): void {
    if (pointer.kind === "touch") this.pressTouch(pointer);
    else if (pointer.kind === "pen") this.pressPen(pointer);
    else this.pressMouse(pointer);
  }

  move(pointerId: number, samples: readonly Vec[]): void {
    const latest = samples.at(-1);
    if (latest === undefined) return;
    if (this.touches.has(pointerId)) this.touches.set(pointerId, latest);
    if (this.phase.kind === "drag" && this.phase.drag.pointerId === pointerId) {
      this.advanceDrag(this.phase.drag, samples, latest);
    } else if (this.phase.kind === "pinch" && this.touches.has(pointerId)) {
      this.advancePinch(this.phase);
    }
  }

  release(pointerId: number): void {
    this.lift(pointerId, true);
  }

  cancel(pointerId: number): void {
    this.lift(pointerId, false);
  }

  wheel(turn: WheelTurn): void {
    if (turn.zooming) {
      const notch = clamp(turn.delta.y, -WHEEL_ZOOM_MAX_DELTA, WHEEL_ZOOM_MAX_DELTA);
      if (notch !== 0) this.sink.zoomAt(turn.client, Math.exp(-notch * WHEEL_ZOOM_RATE));
      return;
    }
    if (!isZero(turn.delta)) this.sink.panBy({ x: -turn.delta.x, y: -turn.delta.y });
  }

  abort(): void {
    if (this.phase.kind === "drag") this.endDrag(this.phase.drag, false);
    this.touches.clear();
    this.phase = IDLE;
  }

  private pressMouse(pointer: PointerPress): void {
    if (this.phase.kind !== "idle") return;
    if (pointer.button === PRIMARY_BUTTON) this.beginDrag(pointer, this.toolMode());
    else if (pointer.button === MIDDLE_BUTTON) this.beginDrag(pointer, "pan");
  }

  private pressPen(pointer: PointerPress): void {
    if (this.phase.kind === "drag") {
      if (this.phase.drag.kind === "pen") return;
      this.abandonDrag(this.phase.drag);
    }
    this.beginDrag(pointer, this.toolMode());
  }

  private pressTouch(pointer: PointerPress): void {
    this.touches.set(pointer.id, pointer.client);
    if (this.phase.kind === "idle") {
      this.beginDrag(pointer, this.toolMode());
      return;
    }
    if (this.phase.kind !== "drag" || this.phase.drag.kind !== "touch") return;
    this.abandonDrag(this.phase.drag);
    const anchor = pinchAnchorOf(this.touches);
    this.phase = anchor === null ? SETTLING : { kind: "pinch", anchor };
  }

  private toolMode(): DragMode {
    return MODE_BY_TOOL[this.currentTool()];
  }

  private beginDrag(pointer: PointerPress, mode: DragMode): void {
    const { id, kind, client } = pointer;
    this.phase = {
      kind: "drag",
      drag: { pointerId: id, kind, mode, start: client, last: client, travelled: false },
    };
    if (mode === "ink") this.sink.penDown(client);
  }

  private advanceDrag(drag: Drag, samples: readonly Vec[], latest: Vec): void {
    drag.travelled ||= samples.some((sample) => distance(drag.start, sample) >= TAP_SLOP_PX);
    if (drag.mode === "ink") {
      for (const sample of samples) this.sink.penMove(sample);
    } else if (drag.mode === "pan" && drag.travelled) {
      this.sink.panBy(subtract(latest, drag.last));
      drag.last = latest;
    }
  }

  private advancePinch(pinch: { anchor: PinchAnchor }): void {
    const next = pinchAnchorOf(this.touches);
    if (next === null) return;
    const previous = pinch.anchor;
    pinch.anchor = next;
    const shift = subtract(next.midpoint, previous.midpoint);
    if (!isZero(shift)) this.sink.panBy(shift);
    const pinchable = previous.span >= MIN_PINCH_SPAN_PX && next.span >= MIN_PINCH_SPAN_PX;
    if (pinchable && next.span !== previous.span) {
      this.sink.zoomAt(next.midpoint, next.span / previous.span);
    }
  }

  private lift(pointerId: number, deliberate: boolean): void {
    this.touches.delete(pointerId);
    if (this.phase.kind === "drag") {
      if (this.phase.drag.pointerId !== pointerId) return;
      this.endDrag(this.phase.drag, deliberate);
      this.phase = this.restingPhase();
      return;
    }
    const anchor = this.phase.kind === "pinch" ? pinchAnchorOf(this.touches) : null;
    this.phase = anchor === null ? this.restingPhase() : { kind: "pinch", anchor };
  }

  private restingPhase(): Phase {
    return this.touches.size === 0 ? IDLE : SETTLING;
  }

  private endDrag(drag: Drag, deliberate: boolean): void {
    if (drag.travelled) {
      if (drag.mode === "ink") this.sink.penUp();
      return;
    }
    if (drag.mode === "ink") this.sink.penCancel();
    if (deliberate) this.sink.tap(drag.start);
  }

  private abandonDrag(drag: Drag): void {
    if (drag.mode === "ink") this.sink.penCancel();
  }
}
