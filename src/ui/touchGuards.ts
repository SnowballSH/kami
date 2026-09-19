import { isTextField } from "./dom";
import type { Detach } from "./types";

const ALWAYS_BLOCKED = ["gesturestart", "gesturechange", "gestureend", "dblclick"] as const;
const BLOCKED_OUTSIDE_TEXT_FIELDS = ["contextmenu", "selectstart"] as const;
const SCROLLABLE_SELECTOR = ".kami-scrollable";

const isInsideScrollable = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(SCROLLABLE_SELECTOR) !== null;

/** Stops pinch-zoom, double-tap zoom, rubber-band scrolling, callouts and selection from firing mid-stroke. */
export const installTouchGuards = (target: Document): Detach => {
  const listeners = new AbortController();
  const options = { signal: listeners.signal, passive: false };
  for (const type of ALWAYS_BLOCKED) {
    target.addEventListener(type, (event) => event.preventDefault(), options);
  }
  for (const type of BLOCKED_OUTSIDE_TEXT_FIELDS) {
    target.addEventListener(
      type,
      (event) => {
        if (!isTextField(event.target)) event.preventDefault();
      },
      options,
    );
  }
  target.addEventListener(
    "touchmove",
    (event) => {
      if (!isTextField(event.target) && !isInsideScrollable(event.target)) event.preventDefault();
    },
    options,
  );
  return () => listeners.abort();
};
