import { isTextField } from "./dom";
import type { Detach } from "./types";
import type { Direction, PressedListener } from "./walkIntent";

const DIRECTION_BY_CODE: Readonly<Record<string, Direction>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

export class KeyboardWalk {
  private readonly onPressedChange: PressedListener;
  private readonly heldCodes = new Set<string>();

  constructor(onPressedChange: PressedListener) {
    this.onPressedChange = onPressedChange;
  }

  attach(target: Window): Detach {
    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    target.addEventListener("keydown", (event) => this.handleKeyDown(event), options);
    target.addEventListener("keyup", (event) => this.handleKeyUp(event), options);
    target.addEventListener("blur", () => this.releaseAll(), options);
    return () => listeners.abort();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (isTextField(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (DIRECTION_BY_CODE[event.code] === undefined) return;
    event.preventDefault();
    if (this.heldCodes.has(event.code)) return;
    this.heldCodes.add(event.code);
    this.publish();
  }

  private handleKeyUp(event: KeyboardEvent): void {
    if (this.heldCodes.delete(event.code)) this.publish();
  }

  private releaseAll(): void {
    if (this.heldCodes.size === 0) return;
    this.heldCodes.clear();
    this.publish();
  }

  private publish(): void {
    const pressed = [...this.heldCodes].flatMap((code) => DIRECTION_BY_CODE[code] ?? []);
    this.onPressedChange(new Set(pressed));
  }
}
