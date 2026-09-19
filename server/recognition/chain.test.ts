// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRecognizerChain } from "./chain";
import type { FetchLike, InProcessSketchRanker, Ranking, RankOptions } from "./types";

const SIDECAR = "http://127.0.0.1:8790";
const SKETCH = [[{ x: 0, y: 0 }]];
const FROM_KNN: Ranking = [{ category: "circle", confidence: 0.5 }];

const down: FetchLike = async () => {
  throw new TypeError("connection refused");
};

class RecordingKnn implements InProcessSketchRanker {
  readonly asked: (RankOptions | undefined)[] = [];

  rank(_strokes: unknown, options?: RankOptions): Ranking {
    this.asked.push(options);
    return FROM_KNN;
  }
}

describe("createRecognizerChain", () => {
  it("is the k-NN alone when no sidecar is configured", async () => {
    const chain = createRecognizerChain(null, new RecordingKnn(), { fetchFn: down });
    expect(await chain.recognizer.rank(SKETCH)).toEqual(FROM_KNN);
    expect(await chain.describe()).toContain("not configured");
  });

  it("falls back to the k-NN when the configured sidecar is down", async () => {
    const chain = createRecognizerChain(SIDECAR, new RecordingKnn(), {
      fetchFn: down,
      log: () => {},
    });
    expect(await chain.recognizer.rank(SKETCH)).toEqual(FROM_KNN);
    expect(await chain.describe()).toBe("eye: not running, using k-NN");
  });

  it.each([
    ["no sidecar is configured", null],
    ["the configured sidecar is down", SIDECAR],
  ])("tells the k-NN the sketch is still under the pen when %s", async (_case, sidecarUrl) => {
    const knn = new RecordingKnn();
    const chain = createRecognizerChain(sidecarUrl, knn, { fetchFn: down, log: () => {} });
    await chain.recognizer.rank(SKETCH, { partial: true });
    expect(knn.asked).toEqual([{ partial: true }]);
  });
});
