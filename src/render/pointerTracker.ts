import type { Vec } from "../core/geometry";

const LISTENING = { passive: true } as const;
const HOVERLESS_POINTER = "touch";

export class PointerTracker {
  private at: Vec | null = null;
  private readonly pressed = new Set<number>();
  private gesturing = false;

  constructor(target: HTMLElement) {
    target.addEventListener("pointerdown", this.press, LISTENING);
    target.addEventListener("pointermove", this.follow, LISTENING);
    target.addEventListener("pointerup", this.lift, LISTENING);
    target.addEventListener("pointercancel", this.depart, LISTENING);
    target.addEventListener("pointerleave", this.depart, LISTENING);
  }

  get client(): Vec | null {
    return this.gesturing ? null : this.at;
  }

  private readonly press = (event: PointerEvent): void => {
    this.pressed.add(event.pointerId);
    if (this.pressed.size > 1) this.gesturing = true;
    this.follow(event);
  };

  private readonly follow = (event: PointerEvent): void => {
    if (event.isPrimary) this.at = { x: event.clientX, y: event.clientY };
  };

  private readonly lift = (event: PointerEvent): void => {
    this.release(event);
    if (event.isPrimary && event.pointerType === HOVERLESS_POINTER) this.at = null;
  };

  private readonly depart = (event: PointerEvent): void => {
    this.release(event);
    if (event.isPrimary) this.at = null;
  };

  private release(event: PointerEvent): void {
    this.pressed.delete(event.pointerId);
    if (this.pressed.size === 0) this.gesturing = false;
  }
}
