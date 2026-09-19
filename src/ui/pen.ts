import type { Vec } from "../core/geometry";
import { capturePointer, isTextField, releasePointer } from "./dom";
import type { Detach, PenSink } from "./types";

const PRIMARY_BUTTON = 0;
const END_EVENTS = ["pointerup", "pointercancel", "lostpointercapture"] as const;

type ToWorld = (clientX: number, clientY: number) => Vec;

const coalesced = (event: PointerEvent): readonly PointerEvent[] => {
  const samples = "getCoalescedEvents" in event ? event.getCoalescedEvents() : [];
  return samples.length > 0 ? samples : [event];
};

const dismissKeyboard = (owner: Document): void => {
  const focused = owner.activeElement;
  if (focused instanceof HTMLElement && isTextField(focused)) focused.blur();
};

export class PenTracker {
  private readonly canvas: HTMLCanvasElement;
  private readonly toWorld: ToWorld;
  private readonly sink: PenSink;
  private owner: number | null = null;

  constructor(canvas: HTMLCanvasElement, toWorld: ToWorld, sink: PenSink) {
    this.canvas = canvas;
    this.toWorld = toWorld;
    this.sink = sink;
  }

  attach(): Detach {
    const listeners = new AbortController();
    const options = { signal: listeners.signal, passive: false };
    this.canvas.addEventListener("pointerdown", (event) => this.handleDown(event), options);
    this.canvas.addEventListener("pointermove", (event) => this.handleMove(event), options);
    for (const type of END_EVENTS) {
      this.canvas.addEventListener(type, (event) => this.handleEnd(event), options);
    }
    return () => {
      listeners.abort();
      this.finish();
    };
  }

  private handleDown(event: PointerEvent): void {
    event.preventDefault();
    if (this.owner !== null) return;
    if (event.pointerType === "mouse" && event.button !== PRIMARY_BUTTON) return;
    this.owner = event.pointerId;
    capturePointer(this.canvas, event.pointerId);
    dismissKeyboard(this.canvas.ownerDocument);
    this.sink.penDown(this.toWorld(event.clientX, event.clientY));
  }

  private handleMove(event: PointerEvent): void {
    event.preventDefault();
    if (event.pointerId !== this.owner) return;
    for (const sample of coalesced(event)) {
      this.sink.penMove(this.toWorld(sample.clientX, sample.clientY));
    }
  }

  private handleEnd(event: PointerEvent): void {
    event.preventDefault();
    if (event.pointerId === this.owner) this.finish();
  }

  private finish(): void {
    if (this.owner === null) return;
    releasePointer(this.canvas, this.owner);
    this.owner = null;
    this.sink.penUp();
  }
}
