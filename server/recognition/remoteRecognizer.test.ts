// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { lineSketch } from "../testing/sketches";
import {
  FINISHED_TIMEOUT_MS,
  PARTIAL_TIMEOUT_MS,
  REQUESTED_GUESSES,
  RemoteSketchRecognizer,
} from "./remoteRecognizer";
import type { FetchLike } from "./types";

const SIDECAR = "http://127.0.0.1:8790/";
const SKETCH = lineSketch({ x: 10, y: 20 }, { x: 300, y: 40 });

interface SeenRequest {
  readonly url: string;
  readonly method: string | undefined;
  readonly body: unknown;
}

const sidecarSaying = (answer: () => Response, seen: SeenRequest[] = []): FetchLike => {
  return async (url, init) => {
    seen.push({ url, method: init?.method, body: JSON.parse(String(init?.body)) });
    return answer();
  };
};

const sidecarThatNeverAnswers: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

afterEach(() => vi.restoreAllMocks());

describe("RemoteSketchRecognizer", () => {
  it("posts the raw strokes to /recognize and pairs labels with probabilities", async () => {
    const seen: SeenRequest[] = [];
    const eye = new RemoteSketchRecognizer(
      SIDECAR,
      sidecarSaying(() => Response.json({ labels: ["cake", "drums"], probs: [0.81, 0.07] }), seen),
    );
    expect(await eye.rank(SKETCH)).toEqual([
      { category: "cake", confidence: 0.81 },
      { category: "drums", confidence: 0.07 },
    ]);
    expect(seen).toEqual([
      {
        url: "http://127.0.0.1:8790/recognize",
        method: "POST",
        body: { strokes: SKETCH, partial: false, top: REQUESTED_GUESSES },
      },
    ]);
  });

  it("gives a drawing still under the pen the short timeout, a finished one the long", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const seen: SeenRequest[] = [];
    const eye = new RemoteSketchRecognizer(
      SIDECAR,
      sidecarSaying(() => Response.json({ labels: [], probs: [] }), seen),
    );
    await eye.rank(SKETCH, { partial: true });
    await eye.rank(SKETCH);
    expect(timeout.mock.calls).toEqual([[PARTIAL_TIMEOUT_MS], [FINISHED_TIMEOUT_MS]]);
    expect(seen.map(({ body }) => body)).toMatchObject([{ partial: true }, { partial: false }]);
    expect(PARTIAL_TIMEOUT_MS).toBeLessThan(FINISHED_TIMEOUT_MS);
  });

  it("is null when the sidecar does not answer in time", async () => {
    const asked = performance.now();
    const eye = new RemoteSketchRecognizer(SIDECAR, sidecarThatNeverAnswers);
    expect(await eye.rank(SKETCH, { partial: true })).toBeNull();
    expect(performance.now() - asked).toBeLessThan(FINISHED_TIMEOUT_MS);
  });

  it("is null when the sidecar is down or answers with an error", async () => {
    const refusing: FetchLike = async () => {
      throw new TypeError("connection refused");
    };
    const failing = sidecarSaying(() => Response.json({ error: "boom" }, { status: 500 }));
    expect(await new RemoteSketchRecognizer(SIDECAR, refusing).rank(SKETCH)).toBeNull();
    expect(await new RemoteSketchRecognizer(SIDECAR, failing).rank(SKETCH)).toBeNull();
  });

  it("is null when the body is not what the contract promises", async () => {
    const malformed = [
      () => new Response("<html>not json</html>"),
      () => Response.json({ labels: ["cake"] }),
      () => Response.json({ labels: ["cake", "drums"], probs: [0.9] }),
      () => Response.json({ labels: [7], probs: ["high"] }),
    ];
    for (const answer of malformed) {
      expect(
        await new RemoteSketchRecognizer(SIDECAR, sidecarSaying(answer)).rank(SKETCH),
      ).toBeNull();
    }
  });
});
