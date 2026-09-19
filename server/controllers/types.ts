/** The contract of the physical-controller relay; docs/controllers.md is the prose version. */

export const DIRECTIONS = ["left", "right", "up", "down"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const BUTTONS = ["a", "b", "x", "y"] as const;
export type Button = (typeof BUTTONS)[number];

export const TRANSPORTS = ["udp", "serial", "http"] as const;
export type Transport = (typeof TRANSPORTS)[number];

/** What a controller says: both axes in percent of travel, -100 … 100 with y up, and the buttons held. */
export interface ControllerReading {
  readonly x: number;
  readonly y: number;
  readonly buttons: readonly Button[];
}

export interface ControllerMessage {
  readonly controller: string;
  readonly reading: ControllerReading;
}

/** What the game hears: the axes as -1 … 1 with y up, and what the hub decided is held. */
export interface ControllerState {
  readonly x: number;
  readonly y: number;
  readonly held: readonly Direction[];
  readonly buttons: readonly Button[];
}

export interface ControllerReport extends ControllerState {
  readonly id: string;
  readonly transport: Transport;
  readonly idleMs: number;
}

export type ControllerListener = (state: ControllerState) => void;
export type Unsubscribe = () => void;

export interface ControllerHub {
  report(id: string, reading: ControllerReading, transport: Transport): void;
  /** The listener hears the current state at once, then every change of the axes, `held` or `buttons`. */
  subscribe(id: string, listener: ControllerListener): Unsubscribe;
  list(): readonly ControllerReport[];
  close(): void;
}

export type CancelTimer = () => void;

export interface HubClock {
  now(): number;
  schedule(task: () => void, delayMs: number): CancelTimer;
}

export type Log = (line: string) => void;

/** A transport feeding the hub (UDP socket, serial device). */
export interface ControllerInput {
  readonly description: string;
  close(): Promise<void>;
}

/** `null` switches a transport off; `serialDevice` is a device path or `AUTO_SERIAL_DEVICE`. */
export interface ControllerTransportConfig {
  readonly udpPort: number | null;
  readonly serialDevice: string | null;
}

export const AUTO_SERIAL_DEVICE = "auto";
