import { isTextField } from "./dom";
import type { Detach } from "./types";

const UNDO_KEY = "z";

/** Ctrl+Z, or ⌘Z on a Mac. Shift turns it into redo elsewhere, and Kami has no redo. */
const isUndo = (event: KeyboardEvent): boolean =>
  event.key.toLowerCase() === UNDO_KEY &&
  (event.ctrlKey || event.metaKey) &&
  !event.altKey &&
  !event.shiftKey;

/** Takes back the last thing drawn or written, once per press; a text field keeps its own undo. */
export class UndoHotkey {
  private readonly onUndo: () => void;

  constructor(onUndo: () => void) {
    this.onUndo = onUndo;
  }

  attach(host: Window): Detach {
    const listeners = new AbortController();
    host.addEventListener("keydown", (event) => this.handleKeyDown(event), {
      signal: listeners.signal,
    });
    return () => listeners.abort();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (!isUndo(event) || isTextField(event.target)) return;
    event.preventDefault();
    if (!event.repeat) this.onUndo();
  }
}
