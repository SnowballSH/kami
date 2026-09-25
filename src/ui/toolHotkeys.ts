import { isTextField } from "./dom";
import { TOOL_SPECS } from "./toolbar";
import type { Detach, Tool } from "./types";

export interface ToolHotkeyTarget {
  pick(tool: Tool): void;
  holdPan(): void;
  releasePan(): void;
}

const HOLD_PAN_KEY = " ";

const TOOL_BY_KEY: ReadonlyMap<string, Tool> = new Map(
  TOOL_SPECS.map((spec) => [spec.hotkey, spec.tool]),
);

const SPACE_ACTIVATES = "button, a[href], [tabindex]";

/** A focused control that Space presses keeps its Space; holding it there must not pan instead. */
const pressesWithSpace = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(SPACE_ACTIVATES) !== null;

const hasModifier = (event: KeyboardEvent): boolean =>
  event.metaKey || event.ctrlKey || event.altKey;

export class ToolHotkeys {
  private readonly target: ToolHotkeyTarget;

  constructor(target: ToolHotkeyTarget) {
    this.target = target;
  }

  attach(host: Window): Detach {
    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    host.addEventListener("keydown", (event) => this.handleKeyDown(event), options);
    host.addEventListener("keyup", (event) => this.handleKeyUp(event), options);
    host.addEventListener("blur", () => this.target.releasePan(), options);
    return () => listeners.abort();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (isTextField(event.target) || hasModifier(event)) return;
    if (event.key === HOLD_PAN_KEY) {
      if (pressesWithSpace(event.target)) return;
      event.preventDefault();
      if (!event.repeat) this.target.holdPan();
      return;
    }
    const tool = TOOL_BY_KEY.get(event.key.toLowerCase());
    if (tool === undefined || event.repeat) return;
    event.preventDefault();
    this.target.pick(tool);
  }

  private handleKeyUp(event: KeyboardEvent): void {
    if (event.key !== HOLD_PAN_KEY) return;
    if (!isTextField(event.target) && !pressesWithSpace(event.target)) event.preventDefault();
    this.target.releasePan();
  }
}
