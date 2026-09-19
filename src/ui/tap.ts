import { capturePointer, releasePointer } from "./dom";

const TAP_SLOP_PX = 12;
const SWALLOW_CLICK_MS = 700;
const PRIMARY_BUTTON = 0;

interface PendingTap {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
}

const belongsToNestedButton = (target: EventTarget | null, element: HTMLElement): boolean => {
  if (!(target instanceof Element)) return false;
  const button = target.closest("button");
  return button !== null && button !== element && element.contains(button);
};

/**
 * Activates `element` on a pointer tap — finger, Pencil or mouse — without waiting for the
 * browser's synthesized `click`, which iPadOS delivers late or not at all for the Pencil.
 * The synthesized click that may follow is swallowed; keyboard clicks still activate.
 */
export const onTap = (element: HTMLElement, activate: () => void): void => {
  let pending: PendingTap | null = null;
  let swallowClicksUntil = 0;

  const settle = (event: PointerEvent, hit: boolean): void => {
    if (pending?.pointerId !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
    pending = null;
    releasePointer(element, event.pointerId);
    if (!hit || moved > TAP_SLOP_PX) return;
    swallowClicksUntil = event.timeStamp + SWALLOW_CLICK_MS;
    activate();
  };

  element.addEventListener("pointerdown", (event) => {
    if (pending !== null || (event.pointerType === "mouse" && event.button !== PRIMARY_BUTTON)) {
      return;
    }
    if (belongsToNestedButton(event.target, element)) return;
    event.preventDefault();
    pending = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    capturePointer(element, event.pointerId);
  });
  element.addEventListener("pointerup", (event) => settle(event, true));
  element.addEventListener("pointercancel", (event) => settle(event, false));
  element.addEventListener("click", (event) => {
    if (event.timeStamp < swallowClicksUntil) {
      event.stopImmediatePropagation();
      event.preventDefault();
      return;
    }
    activate();
  });
};
