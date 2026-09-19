import { FULL_TRAVEL } from "./message";
import {
  type Button,
  type CancelTimer,
  type ControllerHub,
  type ControllerListener,
  type ControllerReading,
  type ControllerReport,
  type ControllerState,
  DIRECTIONS,
  type Direction,
  type HubClock,
  type Transport,
  type Unsubscribe,
} from "./types";

export const PRESS_AT = 40;
export const RELEASE_BELOW = 30;
export const STALE_AFTER_MS = 1_000;
export const FORGET_AFTER_MS = 60_000;

const JUMP_BUTTON: Button = "a";
const JUMP_DIRECTION: Direction = "up";

const AT_REST: ControllerState = { x: 0, y: 0, held: [], buttons: [] };

export const systemClock: HubClock = {
  now: () => Date.now(),
  schedule: (task, delayMs) => {
    const timer = setTimeout(task, delayMs);
    timer.unref();
    return () => clearTimeout(timer);
  },
};

const TRAVEL_TOWARDS: Readonly<Record<Direction, (reading: ControllerReading) => number>> = {
  left: ({ x }) => -x,
  right: ({ x }) => x,
  up: ({ y }) => y,
  down: ({ y }) => -y,
};

const tiltOf = (reading: ControllerReading, tilted: readonly Direction[]): readonly Direction[] =>
  DIRECTIONS.filter(
    (direction) =>
      TRAVEL_TOWARDS[direction](reading) >= (tilted.includes(direction) ? RELEASE_BELOW : PRESS_AT),
  );

const heldOf = (tilt: readonly Direction[], buttons: readonly Button[]): readonly Direction[] =>
  DIRECTIONS.filter(
    (direction) =>
      tilt.includes(direction) || (direction === JUMP_DIRECTION && buttons.includes(JUMP_BUTTON)),
  );

const sameState = (one: ControllerState, other: ControllerState): boolean =>
  one.x === other.x &&
  one.y === other.y &&
  one.held.join() === other.held.join() &&
  one.buttons.join() === other.buttons.join();

interface TrackedController {
  tilt: readonly Direction[];
  state: ControllerState;
  transport: Transport;
  heardAt: number;
  cancelTimer: CancelTimer;
}

export class InMemoryControllerHub implements ControllerHub {
  readonly #clock: HubClock;
  readonly #controllers = new Map<string, TrackedController>();
  readonly #listeners = new Map<string, Set<ControllerListener>>();
  #closed = false;

  constructor(clock: HubClock = systemClock) {
    this.#clock = clock;
  }

  report(id: string, reading: ControllerReading, transport: Transport): void {
    if (this.#closed) return;
    const tracked = this.#controllers.get(id);
    tracked?.cancelTimer();
    const tilt = tiltOf(reading, tracked?.tilt ?? []);
    const state: ControllerState = {
      x: reading.x / FULL_TRAVEL,
      y: reading.y / FULL_TRAVEL,
      held: heldOf(tilt, reading.buttons),
      buttons: reading.buttons,
    };
    this.#controllers.set(id, {
      tilt,
      state,
      transport,
      heardAt: this.#clock.now(),
      cancelTimer: this.#clock.schedule(() => this.#letGo(id), STALE_AFTER_MS),
    });
    if (!sameState(tracked?.state ?? AT_REST, state)) this.#tell(id, state);
  }

  subscribe(id: string, listener: ControllerListener): Unsubscribe {
    if (this.#closed) return () => {};
    const listeners = this.#listeners.get(id) ?? new Set<ControllerListener>();
    this.#listeners.set(id, listeners);
    listeners.add(listener);
    this.#hear(listener, this.#controllers.get(id)?.state ?? AT_REST);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && this.#listeners.get(id) === listeners) this.#listeners.delete(id);
    };
  }

  list(): readonly ControllerReport[] {
    const now = this.#clock.now();
    return [...this.#controllers].map(([id, { state, transport, heardAt }]) => ({
      id,
      ...state,
      transport,
      idleMs: now - heardAt,
    }));
  }

  close(): void {
    this.#closed = true;
    for (const { cancelTimer } of this.#controllers.values()) cancelTimer();
    this.#controllers.clear();
    this.#listeners.clear();
  }

  #letGo(id: string): void {
    const tracked = this.#controllers.get(id);
    if (tracked === undefined) return;
    const wasAtRest = sameState(tracked.state, AT_REST);
    this.#controllers.set(id, {
      ...tracked,
      tilt: [],
      state: AT_REST,
      cancelTimer: this.#clock.schedule(
        () => this.#controllers.delete(id),
        FORGET_AFTER_MS - STALE_AFTER_MS,
      ),
    });
    if (!wasAtRest) this.#tell(id, AT_REST);
  }

  #tell(id: string, state: ControllerState): void {
    for (const listener of this.#listeners.get(id) ?? []) this.#hear(listener, state);
  }

  #hear(listener: ControllerListener, state: ControllerState): void {
    try {
      listener(state);
    } catch (error) {
      console.error("a controller listener failed", error);
    }
  }
}
