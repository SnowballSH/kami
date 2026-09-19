import { API_BASE } from "../persistence/api";
import type { Detach } from "../ui/types";
import type { Direction, PressedListener } from "../ui/walkIntent";
import { parseControllerState, pressedDirections } from "./controllerState";
import type { RemoteStickOptions } from "./types";

export const controllerEventsPath = (controllerId: string): string =>
  `${API_BASE}/controllers/${encodeURIComponent(controllerId)}/events`;

const NOTHING_PRESSED: ReadonlySet<Direction> = new Set();

const samePressed = (a: ReadonlySet<Direction>, b: ReadonlySet<Direction>): boolean =>
  a.size === b.size && [...a].every((direction) => b.has(direction));

/** A physical stick, relayed by the server as server-sent events, as one more walk source. */
export class RemoteStick {
  private readonly onPressedChange: PressedListener;
  private readonly options: RemoteStickOptions;
  private pressed = NOTHING_PRESSED;

  constructor(onPressedChange: PressedListener, options: RemoteStickOptions) {
    this.onPressedChange = onPressedChange;
    this.options = options;
  }

  attach(): Detach {
    const { controllerId, openEventSource } = this.options;
    const source = openEventSource(controllerEventsPath(controllerId));
    source.addEventListener("message", (message) => this.handleMessage(message.data));
    source.addEventListener("error", () => this.publish(NOTHING_PRESSED));
    return () => {
      source.close();
      this.publish(NOTHING_PRESSED);
    };
  }

  private handleMessage(data: unknown): void {
    const state = parseControllerState(data);
    if (state !== null) this.publish(pressedDirections(state));
  }

  private publish(pressed: ReadonlySet<Direction>): void {
    if (samePressed(pressed, this.pressed)) return;
    this.pressed = pressed;
    this.onPressedChange(pressed);
  }
}
