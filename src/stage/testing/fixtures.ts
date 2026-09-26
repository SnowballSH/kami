import type { BoardDefinition } from "../../board/types";
import type { Stroke } from "../../core/geometry";
import type { PenScript } from "../../handwriting/types";
import type { DrawingId } from "../../ink/types";
import type { NoteId } from "../../notes/types";
import type { InkView, NoteView, RenderFrame } from "../../render/types";
import type { AliceSnapshot } from "../../sim/types";
import type { DialStage, LineHandlers, StageLine } from "../line";

export const BOARD: BoardDefinition = {
  id: "stage-test",
  title: "Stage test",
  spawn: { x: 0, y: 0 },
  killY: 1000,
  solids: [],
  zones: [],
  noInkZones: [],
};

export const strokesOf = (seed: number): readonly Stroke[] => [
  [
    { x: seed, y: 0 },
    { x: seed + 10, y: 5, pressure: 0.5 },
  ],
];

export const inkOf = (id: string, strokes: readonly Stroke[]): InkView => ({
  drawing: { id: id as DrawingId, strokes, cost: 11 },
  pose: { origin: { x: 0, y: 0 }, position: { x: 3, y: 4 }, angle: 0.5, scale: 1 },
  nature: "solid",
  lit: false,
  awakenedAtMs: null,
});

export const scriptOf = (text: string): PenScript => ({
  text,
  strokes: strokesOf(1),
  startsAtMs: [0],
  endsAtMs: [100],
  durationMs: 100,
  bounds: { x: 0, y: 0, width: 10, height: 5 },
});

export const noteOf = (id: string, script: PenScript): NoteView => ({
  id: id as NoteId,
  author: "kami",
  tone: "plain",
  script,
  writtenAtMs: 5,
  tappable: false,
  opacity: 1,
});

export const frameAt = (nowMs: number, parts: Partial<RenderFrame> = {}): RenderFrame => ({
  nowMs,
  camera: { center: { x: 20, y: 20 }, zoom: 2, angle: 0 },
  world: {
    alice: null,
    soul: null,
    tear: null,
    twins: [],
    sumikui: null,
    drawings: [],
    bites: [],
    keyTaken: false,
    doorOpen: false,
  },
  daylight: 1,
  inks: [],
  notes: [],
  activeStrokes: [],
  activeVerdict: "ok",
  heldInks: [],
  eraserActive: false,
  ...parts,
});

export const ALICE: AliceSnapshot = {
  center: { x: 10, y: 20 },
  velocity: { x: 0, y: 0 },
  width: 28,
  height: 60,
  size: "normal",
  sizeMultiplier: 1,
  headingScale: 1,
  facing: 1,
  walking: false,
  grounded: true,
  climbing: false,
  hasKey: false,
  ride: null,
  look: { kind: "alice" },
};

export const VIEWPORT = { width: 1024, height: 768 };

/** A line the test holds both ends of. */
export class FakeExchange {
  readonly sent: string[] = [];
  readonly retries: number[] = [];
  queued = 0;
  dials = 0;
  #handlers: LineHandlers | null = null;

  readonly dial: DialStage = (handlers): StageLine => {
    this.dials += 1;
    this.#handlers = handlers;
    return {
      send: (message) => void this.sent.push(message),
      buffered: () => this.queued,
      close: () => this.drop(),
    };
  };

  readonly schedule = (task: () => void, afterMs: number): void => {
    this.retries.push(afterMs);
    this.#redial = task;
  };

  #redial: (() => void) | null = null;

  open(): void {
    this.#handlers?.opened();
  }

  say(message: string): void {
    this.#handlers?.message(message);
  }

  drop(): void {
    this.#handlers?.closed();
  }

  redial(): void {
    this.#redial?.();
  }

  kinds(): string[] {
    return this.sent.map((message) => message.split("\n", 1)[0] ?? "");
  }
}
