import { capturePointer, releasePointer } from "./dom";

const LOST_EVENTS = ["pointercancel", "lostpointercapture"] as const;
const PRIMARY_BUTTON = 0;
const CLICK_ECHO_MS = 1000;

const within = (element: Element, event: PointerEvent): boolean => {
  const box = element.getBoundingClientRect();
  return (
    event.clientX >= box.left &&
    event.clientX <= box.right &&
    event.clientY >= box.top &&
    event.clientY <= box.bottom
  );
};

/**
 * Fires `act` when a pen, finger or mouse presses and lifts on `element`, and again for keyboard
 * activation. Apple Pencil taps do not reliably become clicks, so the pointer lift is the
 * activation; the click a browser then synthesises is swallowed. Clicks with no pointer behind
 * them (Enter, Space, `element.click()`) still activate.
 */
export const activateOnTap = (element: HTMLElement, act: () => void): void => {
  let pressed: number | null = null;
  let liftedAt = Number.NEGATIVE_INFINITY;

  element.addEventListener("pointerdown", (event) => {
    if (event.button !== PRIMARY_BUTTON || pressed !== null) return;
    event.preventDefault();
    pressed = event.pointerId;
    capturePointer(element, event.pointerId);
  });

  element.addEventListener("pointerup", (event) => {
    if (event.pointerId !== pressed) return;
    pressed = null;
    releasePointer(element, event.pointerId);
    liftedAt = event.timeStamp;
    if (within(element, event)) act();
  });

  for (const type of LOST_EVENTS) {
    element.addEventListener(type, (event) => {
      if (event.pointerId === pressed) pressed = null;
    });
  }

  element.addEventListener("click", (event) => {
    const echoOfTap = event.detail > 0 && event.timeStamp - liftedAt < CLICK_ECHO_MS;
    if (!echoOfTap) act();
  });
};
