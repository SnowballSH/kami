import type { Vec } from "../core/geometry";
import { capturePointer, el, releasePointer } from "./dom";
import type { Detach } from "./types";
import type { Direction, PressedListener } from "./walkIntent";

export const STICK_RADIUS_PX = 56;
export const DEAD_ZONE = 0.3;
const DIAGONAL = 0.5;
const HELD_CLASS = "is-held";
const RELEASE_EVENTS = ["pointerup", "pointercancel", "lostpointercapture"] as const;
const PRIMARY_BUTTON = 0;

/** The thumb's offset clamped to the rim, as a fraction of the stick's radius. */
export const deflectionOf = (offset: Vec, radiusPx: number): Vec => {
  const distance = Math.hypot(offset.x, offset.y);
  const clamp = distance > radiusPx ? radiusPx / distance : 1;
  return { x: (offset.x * clamp) / radiusPx, y: (offset.y * clamp) / radiusPx };
};

/** An axis counts once pushed past the dead zone and at least half as far as the other axis. */
const counts = (own: number, other: number): boolean => own > DEAD_ZONE && own >= other * DIAGONAL;

/** Diagonals walk and climb (or hop) together; a thumb drifting slightly up mid-walk does not hop. */
export const directionsOf = (deflection: Vec): ReadonlySet<Direction> => {
  const held = new Set<Direction>();
  const across = Math.abs(deflection.x);
  const along = Math.abs(deflection.y);
  if (counts(across, along)) held.add(deflection.x > 0 ? "right" : "left");
  if (counts(along, across)) held.add(deflection.y > 0 ? "down" : "up");
  return held;
};

/** A thumbstick for the booth: pen, finger or mouse, one pointer at a time, springs back on lift. */
export class Joystick {
  readonly element: HTMLElement;
  private readonly thumb: HTMLElement;
  private readonly onPressedChange: PressedListener;
  private pointer: number | null = null;
  private centre: Vec = { x: 0, y: 0 };

  constructor(onPressedChange: PressedListener) {
    this.onPressedChange = onPressedChange;
    this.thumb = el("div", { className: "kami-stick-thumb" });
    this.element = el(
      "div",
      { className: "kami-stick", attrs: { role: "group", "aria-label": "Walk Alice" } },
      [this.thumb],
    );
    this.element.addEventListener("pointerdown", (event) => this.grab(event));
    this.element.addEventListener("pointermove", (event) => this.steer(event));
    for (const type of RELEASE_EVENTS) {
      this.element.addEventListener(type, (event) => this.release(event));
    }
  }

  /** Lets go when the page loses focus, so a stroke that leaves the window cannot walk her for ever. */
  attach(target: Window): Detach {
    const letGo = () => this.releaseAll();
    target.addEventListener("blur", letGo);
    return () => target.removeEventListener("blur", letGo);
  }

  releaseAll(): void {
    this.pointer = null;
    this.settle({ x: 0, y: 0 });
  }

  private grab(event: PointerEvent): void {
    if (event.button !== PRIMARY_BUTTON || this.pointer !== null) return;
    event.preventDefault();
    this.pointer = event.pointerId;
    const box = this.element.getBoundingClientRect();
    this.centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    capturePointer(this.element, event.pointerId);
    this.element.classList.add(HELD_CLASS);
    this.steer(event);
  }

  private steer(event: PointerEvent): void {
    if (event.pointerId !== this.pointer) return;
    const offset = { x: event.clientX - this.centre.x, y: event.clientY - this.centre.y };
    this.settle(deflectionOf(offset, STICK_RADIUS_PX));
  }

  private release(event: PointerEvent): void {
    if (event.pointerId !== this.pointer) return;
    releasePointer(this.element, event.pointerId);
    this.releaseAll();
  }

  private settle(deflection: Vec): void {
    const held = this.pointer !== null;
    this.element.classList.toggle(HELD_CLASS, held);
    const px = { x: deflection.x * STICK_RADIUS_PX, y: deflection.y * STICK_RADIUS_PX };
    this.thumb.style.transform = `translate(${px.x.toFixed(1)}px, ${px.y.toFixed(1)}px)`;
    this.onPressedChange(held ? directionsOf(deflection) : new Set());
  }
}
