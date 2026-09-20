import {
  FRAME_KIND,
  kindOf,
  MAX_FRAME_BYTES,
  MAX_MESSAGE_BYTES,
  pack,
  SHOWN_KINDS,
} from "../../src/stage/wire";

/** One connected device, as the stage sees it. */
export interface Seat {
  send(message: string): void;
  /** Bytes queued for this device and not yet sent. */
  buffered(): number;
}

/** The device in play keeps the stage until it has been idle this long and another one draws. */
export const HANDOVER_IDLE_MS = 4000;
/** A screen further behind than this misses frames rather than falling further behind. */
export const MOST_BUFFERED_BYTES = 1024 * 1024;

const GO = pack("go");
const REST = pack("rest");
const OFFSTAGE = pack("offstage");
const ACTIVE = "active";

const isShown = (kind: string): boolean => (SHOWN_KINDS as readonly string[]).includes(kind);

/**
 * One stage: the devices people play on (sources), the screens that watch, and which source is
 * live. Only the live source shows anything, and only while a screen is watching; the server never
 * reads what it shows, it passes it on. `docs/screen.md` has the whole protocol.
 */
export class Stage {
  readonly #sources = new Map<Seat, { activeAtMs: number }>();
  readonly #screens = new Set<Seat>();
  #live: Seat | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  get empty(): boolean {
    return this.#sources.size === 0 && this.#screens.size === 0;
  }

  sourceJoined(seat: Seat): void {
    this.#sources.set(seat, { activeAtMs: Number.NEGATIVE_INFINITY });
    if (this.#live === null && this.#screens.size > 0) this.#goLive(seat);
  }

  screenJoined(seat: Seat): void {
    this.#screens.add(seat);
    const next = this.#live ?? this.#mostRecentlyActive();
    if (next === null) seat.send(OFFSTAGE);
    else this.#goLive(next);
  }

  left(seat: Seat): void {
    if (this.#screens.delete(seat)) {
      if (this.#screens.size === 0) this.#rest();
      return;
    }
    if (!this.#sources.delete(seat) || seat !== this.#live) return;
    this.#live = null;
    const next = this.#screens.size === 0 ? null : this.#mostRecentlyActive();
    if (next === null) this.#tellScreens(OFFSTAGE);
    else this.#goLive(next);
  }

  said(seat: Seat, message: string): void {
    const source = this.#sources.get(seat);
    if (source === undefined) return;
    const kind = kindOf(message);
    if (kind === ACTIVE) {
      source.activeAtMs = this.now();
      if (this.#mayTakeOver(seat)) this.#goLive(seat);
      return;
    }
    if (seat !== this.#live || !isShown(kind)) return;
    const droppable = kind === FRAME_KIND;
    if (message.length > (droppable ? MAX_FRAME_BYTES : MAX_MESSAGE_BYTES)) return;
    for (const screen of this.#screens) {
      if (droppable && screen.buffered() > MOST_BUFFERED_BYTES) continue;
      screen.send(message);
    }
  }

  #mayTakeOver(seat: Seat): boolean {
    if (seat === this.#live || this.#screens.size === 0) return false;
    const live = this.#live === null ? undefined : this.#sources.get(this.#live);
    return live === undefined || this.now() - live.activeAtMs >= HANDOVER_IDLE_MS;
  }

  /** `go` also asks a source that is already live to start over, which is how a new screen catches up. */
  #goLive(seat: Seat): void {
    if (this.#live !== null && this.#live !== seat) this.#live.send(REST);
    this.#live = seat;
    seat.send(GO);
  }

  #rest(): void {
    this.#live?.send(REST);
    this.#live = null;
  }

  #mostRecentlyActive(): Seat | null {
    let best: Seat | null = null;
    let bestAtMs = Number.NEGATIVE_INFINITY;
    for (const [seat, { activeAtMs }] of this.#sources) {
      if (best === null || activeAtMs > bestAtMs) [best, bestAtMs] = [seat, activeAtMs];
    }
    return best;
  }

  #tellScreens(message: string): void {
    for (const screen of this.#screens) screen.send(message);
  }
}

export class StageHub {
  readonly #stages = new Map<string, Stage>();

  constructor(private readonly now: () => number = Date.now) {}

  stage(name: string): Stage {
    const known = this.#stages.get(name);
    if (known !== undefined) return known;
    const made = new Stage(this.now);
    this.#stages.set(name, made);
    return made;
  }

  /** Forgets a stage nobody is on, so names made up by visitors do not pile up. */
  left(name: string, seat: Seat): void {
    const stage = this.#stages.get(name);
    if (stage === undefined) return;
    stage.left(seat);
    if (stage.empty) this.#stages.delete(name);
  }
}
