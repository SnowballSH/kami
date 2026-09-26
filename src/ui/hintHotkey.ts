import { isTextField } from "./dom";
import { HINT_HOTKEY } from "./toolbar";
import type { Detach } from "./types";

/** `?` asks the Cat for a hint, once per press; inside a text field it is only a question mark. */
export class HintHotkey {
  private readonly onAsk: () => void;

  constructor(onAsk: () => void) {
    this.onAsk = onAsk;
  }

  attach(host: Window): Detach {
    const listeners = new AbortController();
    host.addEventListener("keydown", (event) => this.handleKeyDown(event), {
      signal: listeners.signal,
    });
    return () => listeners.abort();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== HINT_HOTKEY || isTextField(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    if (!event.repeat) this.onAsk();
  }
}
