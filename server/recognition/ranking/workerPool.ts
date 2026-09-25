/**
 * Ranks sketches on worker threads so a brute-force k-NN pass (several milliseconds over ~50 000
 * rows) never stalls the event loop that every other request shares. The queue is bounded, and live
 * sketches more tightly still: when there is no room, a new drawing takes the place of the oldest
 * waiting live sketch, which is answered with silence at once (the contract allows "nothing to say
 * yet", and a fresher view of the same pen is on its way). When only finished drawings wait, a live
 * sketch gets that silence itself and a finished drawing is refused with `RecognizerBusyError`
 * (the route says 503).
 */
import type { Stroke } from "../../../src/core/geometry";
import {
  DEFAULT_RECOGNIZER_OPTIONS,
  type FeatureMatrix,
  type RecognizerOptions,
} from "../../quickdraw/recognizer";
import { floorFor } from "../certainty";
import type { InProcessSketchRanker, RankOptions, Reading } from "../types";
import type { FromWorker, SpawnWorker, WorkerPort } from "./protocol";

export const DEFAULT_MAX_QUEUED = 32;
/** Live sketches go stale in a long queue, so only this many wait; a newer one replaces the oldest. */
export const DEFAULT_MAX_QUEUED_PARTIALS = 4;

export class RecognizerBusyError extends Error {
  constructor() {
    super("the sketch recogniser has too many drawings waiting");
    this.name = "RecognizerBusyError";
  }
}

export interface PoolSettings {
  readonly threads: number;
  readonly maxQueued: number;
  readonly maxQueuedPartials: number;
  readonly spawn: SpawnWorker;
  readonly log: (line: string) => void;
}

interface Job {
  readonly id: number;
  readonly strokes: readonly Stroke[];
  readonly options: RankOptions;
  readonly resolve: (reading: Reading) => void;
  readonly reject: (error: Error) => void;
}

interface Slot {
  readonly port: WorkerPort;
  job: Job | null;
}

const isPartial = ({ options }: Job): boolean => options.partial === true;

export class WorkerRankingPool implements InProcessSketchRanker {
  readonly #matrix: FeatureMatrix;
  readonly #options: RecognizerOptions;
  readonly #settings: PoolSettings;
  readonly #slots = new Set<Slot>();
  readonly #queue: Job[] = [];
  #nextId = 1;
  #closed = false;

  constructor(
    matrix: FeatureMatrix,
    settings: Partial<PoolSettings> & Pick<PoolSettings, "spawn">,
    options: RecognizerOptions = DEFAULT_RECOGNIZER_OPTIONS,
  ) {
    this.#matrix = matrix;
    this.#options = options;
    this.#settings = {
      threads: Math.max(1, settings.threads ?? 1),
      maxQueued: Math.max(1, settings.maxQueued ?? DEFAULT_MAX_QUEUED),
      maxQueuedPartials: Math.max(1, settings.maxQueuedPartials ?? DEFAULT_MAX_QUEUED_PARTIALS),
      spawn: settings.spawn,
      log: settings.log ?? (() => {}),
    };
    for (let thread = 0; thread < this.#settings.threads; thread += 1) this.#addSlot();
  }

  get threads(): number {
    return this.#slots.size;
  }

  /** Drawings waiting for a thread, not counting the ones being ranked. */
  get queued(): number {
    return this.#queue.length;
  }

  read(strokes: readonly Stroke[], options: RankOptions = {}): Promise<Reading> {
    return new Promise<Reading>((resolve, reject) => {
      if (this.#closed) {
        reject(new Error("the ranking pool is closed"));
        return;
      }
      const job: Job = { id: this.#nextId++, strokes, options, resolve, reject };
      const idle = [...this.#slots].find((slot) => slot.job === null);
      if (idle !== undefined) this.#dispatch(idle, job);
      else this.#enqueue(job);
    });
  }

  close(): void {
    this.#closed = true;
    for (const slot of this.#slots) {
      slot.port.terminate();
      slot.job?.reject(new Error("the ranking pool is closed"));
    }
    this.#slots.clear();
    for (const job of this.#queue.splice(0)) job.reject(new Error("the ranking pool is closed"));
  }

  #enqueue(job: Job): void {
    const roomForAny = this.#queue.length < this.#settings.maxQueued;
    const roomForPartial =
      roomForAny && this.#queue.filter(isPartial).length < this.#settings.maxQueuedPartials;
    if (isPartial(job) ? roomForPartial : roomForAny) {
      this.#queue.push(job);
      return;
    }
    const stalePartial = this.#queue.findIndex(isPartial);
    if (stalePartial === -1) {
      if (isPartial(job)) job.resolve(this.#silence(job));
      else job.reject(new RecognizerBusyError());
      return;
    }
    const [evicted] = this.#queue.splice(stalePartial, 1);
    evicted?.resolve(this.#silence(evicted));
    this.#queue.push(job);
  }

  #silence({ options }: Job): Reading {
    return { ranking: [], certainAbove: floorFor(this.#options.certainAbove, options) };
  }

  #dispatch(slot: Slot, job: Job): void {
    slot.job = job;
    slot.port.postMessage({
      type: "rank",
      id: job.id,
      strokes: job.strokes,
      options: job.options,
    });
  }

  #addSlot(): void {
    const slot: Slot = { port: this.#settings.spawn(), job: null };
    slot.port.postMessage({ type: "load", matrix: this.#matrix, options: this.#options });
    slot.port.onMessage((message) => this.#answered(slot, message));
    slot.port.onError((error) => this.#failed(slot, error));
    this.#slots.add(slot);
  }

  #answered(slot: Slot, message: FromWorker): void {
    const job = slot.job;
    if (job === null || job.id !== message.id) return;
    slot.job = null;
    job.resolve(message.reading);
    const next = this.#queue.shift();
    if (next !== undefined) this.#dispatch(slot, next);
  }

  #failed(slot: Slot, error: unknown): void {
    if (this.#closed) return;
    const reason = error instanceof Error ? error.message : String(error);
    this.#settings.log(`recognition thread failed (${reason}); starting another`);
    slot.port.terminate();
    this.#slots.delete(slot);
    slot.job?.reject(new Error(`the ranking thread failed: ${reason}`));
    this.#addSlot();
    const next = this.#queue.shift();
    const fresh = [...this.#slots].find((candidate) => candidate.job === null);
    if (next !== undefined && fresh !== undefined) this.#dispatch(fresh, next);
  }
}
