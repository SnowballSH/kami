/** The built-in k-NN as the chain sees it: on worker threads by default, on the event loop when asked. */
import { Worker } from "node:worker_threads";
import {
  DEFAULT_RECOGNIZER_OPTIONS,
  type FeatureMatrix,
  QuickdrawRecognizer,
  type RecognizerOptions,
} from "../../quickdraw/recognizer";
import type { InProcessSketchRanker } from "../types";
import type { FromWorker, SpawnWorker, ToWorker, WorkerPort } from "./protocol";
import { WorkerRankingPool } from "./workerPool";

const WORKER_MODULE = new URL("./worker.ts", import.meta.url);

export interface KnnRanker {
  readonly ranker: InProcessSketchRanker;
  /** How many whole sketches are known. */
  readonly size: number;
  describe(): string;
  close(): void;
}

export interface RankerSettings {
  readonly threads: number;
  readonly maxQueued?: number;
  readonly log?: (line: string) => void;
  readonly spawn?: SpawnWorker;
  readonly options?: RecognizerOptions;
}

const portOf = (worker: Worker): WorkerPort => ({
  postMessage: (message: ToWorker) => worker.postMessage(message),
  onMessage: (handler) => worker.on("message", (message: FromWorker) => handler(message)),
  onError: (handler) => {
    worker.on("error", handler);
    worker.on("exit", (code) => {
      if (code !== 0) handler(new Error(`exited with code ${code}`));
    });
  },
  terminate: () => void worker.terminate(),
});

const spawnThread: SpawnWorker = () => portOf(new Worker(WORKER_MODULE));

export const createKnnRanker = (
  matrix: FeatureMatrix,
  {
    threads,
    maxQueued,
    log,
    spawn = spawnThread,
    options = DEFAULT_RECOGNIZER_OPTIONS,
  }: RankerSettings,
): KnnRanker => {
  const size = matrix.completeRows;
  if (threads === 0) {
    return {
      ranker: new QuickdrawRecognizer(matrix, options),
      size,
      describe: () => "k-NN ranks on the event loop (KAMI_RECOGNIZER_THREADS=0)",
      close: () => {},
    };
  }
  const pool = new WorkerRankingPool(
    matrix,
    {
      threads,
      ...(maxQueued === undefined ? {} : { maxQueued }),
      ...(log === undefined ? {} : { log }),
      spawn,
    },
    options,
  );
  return {
    ranker: pool,
    size,
    describe: () =>
      `k-NN ranks on ${pool.threads} worker thread${pool.threads === 1 ? "" : "s"} (KAMI_RECOGNIZER_THREADS)`,
    close: () => pool.close(),
  };
};
