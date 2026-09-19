// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { lineSketch } from "../testing/sketches";
import {
  DEFAULT_CERTAINTY_FLOORS,
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
    expect(await eye.read(SKETCH)).toEqual({
      ranking: [
        { category: "cake", confidence: 0.81 },
        { category: "drums", confidence: 0.07 },
      ],
      certainAbove: DEFAULT_CERTAINTY_FLOORS.finished,
    });
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
    await eye.read(SKETCH, { partial: true });
    await eye.read(SKETCH);
    expect(timeout.mock.calls).toEqual([[PARTIAL_TIMEOUT_MS], [FINISHED_TIMEOUT_MS]]);
    expect(seen.map(({ body }) => body)).toMatchObject([{ partial: true }, { partial: false }]);
    expect(PARTIAL_TIMEOUT_MS).toBeLessThan(FINISHED_TIMEOUT_MS);
  });

  describe("how sure the leader must be to go unasked", () => {
    const CAKE = { labels: ["cake"], probs: [0.97] };
    const eyeSaying = (body: object, floors = DEFAULT_CERTAINTY_FLOORS): RemoteSketchRecognizer =>
      new RemoteSketchRecognizer(
        SIDECAR,
        sidecarSaying(() => Response.json(body)),
        floors,
      );

    it("defaults to the measured floors while the sidecar states none: higher under the pen", async () => {
      expect(DEFAULT_CERTAINTY_FLOORS).toEqual({ finished: 0.8, partial: 0.9 });
      expect((await eyeSaying(CAKE).read(SKETCH))?.certainAbove).toBe(0.8);
      expect((await eyeSaying(CAKE).read(SKETCH, { partial: true }))?.certainAbove).toBe(0.9);
    });

    it("takes the floors it was built with", async () => {
      const cautious = eyeSaying(CAKE, { finished: 0.95, partial: null });
      expect((await cautious.read(SKETCH))?.certainAbove).toBe(0.95);
      expect((await cautious.read(SKETCH, { partial: true }))?.certainAbove).toBeNull();
    });

    it.each([
      ["a number", 0.85, 0.85],
      ["zero", 0, 0],
      ["one", 1, 1],
      ["null, which is never", null, null],
    ])("believes the sidecar when it states %s", async (_case, stated, expected) => {
      const eye = eyeSaying({ ...CAKE, certainAbove: stated });
      expect((await eye.read(SKETCH))?.certainAbove).toBe(expected);
      expect((await eye.read(SKETCH, { partial: true }))?.certainAbove).toBe(expected);
    });

    it.each([
      ["a word", "high"],
      ["a number above one", 1.2],
      ["a negative number", -0.1],
      ["a list", [0.8]],
      ["a truth value", true],
    ])("ignores %s and keeps the ranking", async (_case, garbage) => {
      const eye = eyeSaying({ ...CAKE, certainAbove: garbage });
      expect(await eye.read(SKETCH)).toEqual({
        ranking: [{ category: "cake", confidence: 0.97 }],
        certainAbove: DEFAULT_CERTAINTY_FLOORS.finished,
      });
      expect((await eye.read(SKETCH, { partial: true }))?.certainAbove).toBe(
        DEFAULT_CERTAINTY_FLOORS.partial,
      );
    });
  });

  it("is null when the sidecar does not answer in time", async () => {
    const asked = performance.now();
    const eye = new RemoteSketchRecognizer(SIDECAR, sidecarThatNeverAnswers);
    expect(await eye.read(SKETCH, { partial: true })).toBeNull();
    expect(performance.now() - asked).toBeLessThan(FINISHED_TIMEOUT_MS);
  });

  it("is null when the sidecar is down or answers with an error", async () => {
    const refusing: FetchLike = async () => {
      throw new TypeError("connection refused");
    };
    const failing = sidecarSaying(() => Response.json({ error: "boom" }, { status: 500 }));
    expect(await new RemoteSketchRecognizer(SIDECAR, refusing).read(SKETCH)).toBeNull();
    expect(await new RemoteSketchRecognizer(SIDECAR, failing).read(SKETCH)).toBeNull();
  });

  it("is null when the body is not what the contract promises", async () => {
    const malformed = [
      () => new Response("<html>not json</html>"),
      () => Response.json({ labels: ["cake"] }),
      () => Response.json({ labels: ["cake", "drums"], probs: [0.9] }),
      () => Response.json({ labels: [7], probs: ["high"] }),
      () => Response.json({ labels: [7], probs: ["high"], certainAbove: 0.8 }),
    ];
    for (const answer of malformed) {
      expect(
        await new RemoteSketchRecognizer(SIDECAR, sidecarSaying(answer)).read(SKETCH),
      ).toBeNull();
    }
  });
});
