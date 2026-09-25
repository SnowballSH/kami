/** What the main thread and a ranking worker say to each other. */
import type { Stroke } from "../../../src/core/geometry";
import type { FeatureMatrix, RecognizerOptions } from "../../quickdraw/recognizer";
import type { RankOptions, Reading } from "../types";

export type ToWorker =
  | { readonly type: "load"; readonly matrix: FeatureMatrix; readonly options: RecognizerOptions }
  | {
      readonly type: "rank";
      readonly id: number;
      readonly strokes: readonly Stroke[];
      readonly options: RankOptions;
    };

export type FromWorker = {
  readonly type: "reading";
  readonly id: number;
  readonly reading: Reading;
};

/** The few things a worker thread offers that the pool needs; a test can stand one in without a thread. */
export interface WorkerPort {
  postMessage(message: ToWorker): void;
  onMessage(handler: (message: FromWorker) => void): void;
  onError(handler: (error: unknown) => void): void;
  terminate(): void;
}

export type SpawnWorker = () => WorkerPort;
