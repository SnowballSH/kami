import type { PenPoint, Vec } from "../core/geometry";
import { blurFocusedTextField, capturePointer, releasePointer } from "./dom";
import { GestureMachine, type PointerKind } from "./gestures";
import type { CanvasInputSink, Detach, Tool } from "./types";

const LIFT_EVENTS = ["pointercancel", "lostpointercapture"] as const;
const DELTA_MODE_LINE = 1;
const DELTA_MODE_PAGE = 2;
const WHEEL_LINE_PX = 16;

const clientOf = (event: MouseEvent): Vec => ({ x: event.clientX, y: event.clientY });

const kindOf = (event: PointerEvent): PointerKind =>
  event.pointerType === "pen" || event.pointerType === "touch" ? event.pointerType : "mouse";

/** Only a pen reports pressure worth keeping; a mouse says a constant 0.5 and a finger says 0. */
const penPointOf = (event: PointerEvent): PenPoint =>
  kindOf(event) === "pen" ? { ...clientOf(event), pressure: event.pressure } : clientOf(event);

const coalescedSamples = (event: PointerEvent): readonly PenPoint[] => {
  const samples = "getCoalescedEvents" in event ? event.getCoalescedEvents() : [];
  return (samples.length > 0 ? samples : [event]).map(penPointOf);
};

const wheelUnitPx = (event: WheelEvent, pagePx: number): number => {
  if (event.deltaMode === DELTA_MODE_LINE) return WHEEL_LINE_PX;
  return event.deltaMode === DELTA_MODE_PAGE ? pagePx : 1;
};

export class CanvasInput {
  private readonly canvas: HTMLCanvasElement;
  private readonly gestures: GestureMachine;
  private readonly captured = new Set<number>();

  constructor(canvas: HTMLCanvasElement, currentTool: () => Tool, sink: CanvasInputSink) {
    this.canvas = canvas;
    this.gestures = new GestureMachine(currentTool, sink);
  }

  attach(): Detach {
    const listeners = new AbortController();
    const options = { signal: listeners.signal, passive: false };
    const { canvas } = this;
    canvas.addEventListener("pointerdown", (event) => this.handleDown(event), options);
    canvas.addEventListener("pointermove", (event) => this.handleMove(event), options);
    canvas.addEventListener("pointerup", (event) => this.handleUp(event), options);
    for (const type of LIFT_EVENTS) {
      canvas.addEventListener(type, (event) => this.handleLost(event), options);
    }
    canvas.addEventListener("wheel", (event) => this.handleWheel(event), options);
    canvas.addEventListener("contextmenu", (event) => event.preventDefault(), options);
    return () => {
      listeners.abort();
      this.gestures.abort();
      for (const pointerId of this.captured) releasePointer(canvas, pointerId);
      this.captured.clear();
    };
  }

  private handleDown(event: PointerEvent): void {
    event.preventDefault();
    blurFocusedTextField(this.canvas.ownerDocument);
    capturePointer(this.canvas, event.pointerId);
    this.captured.add(event.pointerId);
    this.gestures.press({
      id: event.pointerId,
      kind: kindOf(event),
      client: penPointOf(event),
      button: event.button,
    });
  }

  private handleMove(event: PointerEvent): void {
    event.preventDefault();
    this.gestures.move(event.pointerId, coalescedSamples(event));
  }

  private handleUp(event: PointerEvent): void {
    event.preventDefault();
    this.gestures.release(event.pointerId);
    this.forget(event.pointerId);
  }

  private handleLost(event: PointerEvent): void {
    this.gestures.cancel(event.pointerId);
    this.forget(event.pointerId);
  }

  private handleWheel(event: WheelEvent): void {
    event.preventDefault();
    const unit = wheelUnitPx(event, this.canvas.clientHeight);
    this.gestures.wheel({
      client: clientOf(event),
      delta: { x: event.deltaX * unit, y: event.deltaY * unit },
      zooming: event.ctrlKey || event.metaKey,
    });
  }

  private forget(pointerId: number): void {
    if (!this.captured.delete(pointerId)) return;
    releasePointer(this.canvas, pointerId);
  }
}
