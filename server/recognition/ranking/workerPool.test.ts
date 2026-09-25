// @vitest-environment node
import { describe, expect, it } from "vitest";
import { computeFeature } from "../../quickdraw/feature";
import { buildFeatureMatrix } from "../../quickdraw/featureMatrix";
import { QuickdrawRecognizer } from "../../quickdraw/recognizer";
import { circleSketch, lineSketch } from "../../testing/sketches";
import type { FromWorker, ToWorker, WorkerPort } from "./protocol";
import { createKnnRanker } from "./ranker";
import { createWorkerState } from "./worker";
import { RecognizerBusyError, WorkerRankingPool } from "./workerPool";

const samples = Array.from({ length: 12 }, (_, index) => [
  { category: "circle", feature: computeFeature(circleSketch({ x: index, y: 0 }, 40 + index)) },
  { category: "line", feature: computeFeature(lineSketch({ x: 0, y: index }, { x: 200, y: 3 })) },
]).flat();
const MATRIX = buildFeatureMatrix(samples);
const CIRCLE = circleSketch({ x: 900, y: 900 }, 300);
const LINE = lineSketch({ x: -50, y: 10 }, { x: 640, y: 22 });

/** A worker without a thread: it answers when the test says so, in order. */
class FakeWorker implements WorkerPort {
  readonly #handle = createWorkerState((message) => this.#pending.push(message));
  readonly #pending: FromWorker[] = [];
  #onMessage: (message: FromWorker) => void = () => {};
  #onError: (error: unknown) => void = () => {};
  terminated = false;
  loads = 0;

  postMessage(message: ToWorker): void {
    if (message.type === "load") this.loads += 1;
    this.#handle(message);
  }
  onMessage(handler: (message: FromWorker) => void): void {
    this.#onMessage = handler;
  }
  onError(handler: (error: unknown) => void): void {
    this.#onError = handler;
  }
  terminate(): void {
    this.terminated = true;
  }

  get answersWaiting(): number {
    return this.#pending.length;
  }
  answerOne(): void {
    const next = this.#pending.shift();
    if (next !== undefined) this.#onMessage(next);
  }
  answerAll(): void {
    while (this.#pending.length > 0) this.answerOne();
  }
  crash(): void {
    this.#onError(new Error("segfault, allegedly"));
  }
}

const poolOf = (threads: number, maxQueued: number) => {
  const workers: FakeWorker[] = [];
  const pool = new WorkerRankingPool(MATRIX, {
    threads,
    maxQueued,
    spawn: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
  });
  return { pool, workers };
};

describe("WorkerRankingPool", () => {
  it("gives every worker the shared matrix once and answers exactly as the in-process k-NN does", async () => {
    const { pool, workers } = poolOf(2, 4);
    expect(workers.map(({ loads }) => loads)).toEqual([1, 1]);
    const reading = pool.read(CIRCLE);
    workers[0]?.answerAll();
    expect(await reading).toEqual(new QuickdrawRecognizer(MATRIX).read(CIRCLE));
    const partial = pool.read(LINE, { partial: true });
    workers[0]?.answerAll();
    expect(await partial).toEqual(new QuickdrawRecognizer(MATRIX).read(LINE, { partial: true }));
  });

  it("queues while every thread is busy and drains in order", async () => {
    const { pool, workers } = poolOf(1, 4);
    const worker = workers[0];
    if (worker === undefined) throw new Error("no worker");
    const first = pool.read(CIRCLE);
    const second = pool.read(LINE);
    const third = pool.read(CIRCLE);
    expect(pool.queued).toBe(2);
    expect(worker.answersWaiting).toBe(1);
    worker.answerOne();
    expect((await first).ranking[0]?.category).toBe("circle");
    expect(pool.queued).toBe(1);
    worker.answerOne();
    expect((await second).ranking[0]?.category).toBe("line");
    worker.answerOne();
    expect((await third).ranking[0]?.category).toBe("circle");
    expect(pool.queued).toBe(0);
  });

  it("lets a fresh live sketch take the place of the oldest waiting one", async () => {
    const { pool, workers } = poolOf(1, 2);
    void pool.read(CIRCLE);
    const stale = pool.read(CIRCLE, { partial: true });
    void pool.read(CIRCLE, { partial: true });
    const fresh = pool.read(LINE, { partial: true });
    expect(await stale).toEqual({ ranking: [], certainAbove: null });
    expect(pool.queued).toBe(2);
    workers[0]?.answerAll();
    expect((await fresh).ranking[0]?.category).toBe("line");
  });

  it("keeps only a few live sketches waiting even while the queue has room", async () => {
    const workers: FakeWorker[] = [];
    const pool = new WorkerRankingPool(MATRIX, {
      threads: 1,
      maxQueued: 8,
      maxQueuedPartials: 2,
      spawn: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    void pool.read(CIRCLE);
    const oldest = pool.read(CIRCLE, { partial: true });
    void pool.read(CIRCLE, { partial: true });
    void pool.read(LINE, { partial: true });
    expect(await oldest).toEqual({ ranking: [], certainAbove: null });
    expect(pool.queued).toBe(2);
    void pool.read(LINE);
    expect(pool.queued).toBe(3);
    workers[0]?.answerAll();
  });

  it("answers a live sketch with silence at once when only finished drawings wait", async () => {
    const { pool, workers } = poolOf(1, 2);
    void pool.read(CIRCLE);
    void pool.read(CIRCLE);
    void pool.read(CIRCLE);
    expect(pool.queued).toBe(2);
    expect(await pool.read(LINE, { partial: true })).toEqual({ ranking: [], certainAbove: null });
    expect(pool.queued).toBe(2);
    workers[0]?.answerAll();
  });

  it("lets a finished drawing take the place of the oldest waiting live sketch", async () => {
    const { pool, workers } = poolOf(1, 2);
    void pool.read(CIRCLE);
    const stale = pool.read(LINE, { partial: true });
    void pool.read(CIRCLE, { partial: true });
    const finished = pool.read(LINE);
    expect(await stale).toEqual({ ranking: [], certainAbove: null });
    expect(pool.queued).toBe(2);
    workers[0]?.answerAll();
    expect((await finished).ranking[0]?.category).toBe("line");
  });

  it("refuses a finished drawing only when finished drawings alone fill the queue", async () => {
    const { pool, workers } = poolOf(1, 1);
    void pool.read(CIRCLE);
    void pool.read(CIRCLE);
    await expect(pool.read(LINE)).rejects.toBeInstanceOf(RecognizerBusyError);
    workers[0]?.answerAll();
  });

  it("replaces a thread that dies, failing only the drawing it held", async () => {
    const lines: string[] = [];
    const workers: FakeWorker[] = [];
    const pool = new WorkerRankingPool(MATRIX, {
      threads: 1,
      spawn: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
      log: (line) => lines.push(line),
    });
    const doomed = pool.read(CIRCLE);
    const waiting = pool.read(LINE);
    workers[0]?.crash();
    await expect(doomed).rejects.toThrow(/ranking thread failed/);
    expect(workers[0]?.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(workers[1]?.loads).toBe(1);
    expect(lines[0]).toContain("segfault");
    workers[1]?.answerAll();
    expect((await waiting).ranking[0]?.category).toBe("line");
  });

  it("rejects everything once closed", async () => {
    const { pool, workers } = poolOf(1, 4);
    const held = pool.read(CIRCLE);
    const queued = pool.read(CIRCLE);
    pool.close();
    await expect(held).rejects.toThrow(/closed/);
    await expect(queued).rejects.toThrow(/closed/);
    await expect(pool.read(CIRCLE)).rejects.toThrow(/closed/);
    expect(workers[0]?.terminated).toBe(true);
  });

  it("lets its threads end quietly once closed", () => {
    const lines: string[] = [];
    const workers: FakeWorker[] = [];
    const pool = new WorkerRankingPool(MATRIX, {
      threads: 1,
      spawn: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
      log: (line) => lines.push(line),
    });
    pool.close();
    workers[0]?.crash();
    expect(lines).toEqual([]);
    expect(workers).toHaveLength(1);
  });
});

describe("createKnnRanker", () => {
  it("ranks on the event loop with zero threads and on a pool otherwise", async () => {
    const inline = createKnnRanker(MATRIX, { threads: 0 });
    expect(inline.size).toBe(24);
    expect(inline.describe()).toContain("event loop");
    expect(await inline.ranker.read(CIRCLE)).toEqual(new QuickdrawRecognizer(MATRIX).read(CIRCLE));

    const worker = new FakeWorker();
    const pooled = createKnnRanker(MATRIX, { threads: 1, spawn: () => worker });
    expect(pooled.describe()).toContain("1 worker thread");
    const reading = pooled.ranker.read(LINE);
    worker.answerAll();
    expect((await reading).ranking[0]?.category).toBe("line");
    pooled.close();
    expect(worker.terminated).toBe(true);
  });
});
