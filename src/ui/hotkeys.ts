import { isTextField } from "./dom";
import type { Detach } from "./types";

export const HINT_HOTKEY = "?";
const UNDO_KEY = "z";

const hasModifier = (event: KeyboardEvent): boolean =>
  event.metaKey || event.ctrlKey || event.altKey;

/** `?` asks the Cat for a hint. */
export const isHint = (event: KeyboardEvent): boolean =>
  event.key === HINT_HOTKEY && !hasModifier(event);

/** Ctrl+Z, or ⌘Z on a Mac. Shift turns it into redo elsewhere, and Kami has no redo. */
export const isUndo = (event: KeyboardEvent): boolean =>
  event.key.toLowerCase() === UNDO_KEY &&
  (event.ctrlKey || event.metaKey) &&
  !event.altKey &&
  !event.shiftKey;

/** Acts once per press of a key that `matches`; inside a text field the key keeps its own meaning. */
export const attachHotkey = (
  host: Window,
  matches: (event: KeyboardEvent) => boolean,
  act: () => void,
): Detach => {
  const listeners = new AbortController();
  host.addEventListener(
    "keydown",
    (event) => {
      if (!matches(event) || isTextField(event.target)) return;
      event.preventDefault();
      if (!event.repeat) act();
    },
    { signal: listeners.signal },
  );
  return () => listeners.abort();
};
