// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Stroke } from "../../src/core/geometry";
import type { FetchLike } from "../recognition/types";
import { SidecarTranscriber, type SidecarTranscriberTiming } from "./sidecarTranscriber";

const SIDECAR = "http://127.0.0.1:8790";
const FAST: SidecarTranscriberTiming = { requestTimeoutMs: 1_000, warmUpTimeoutMs: 50, pollMs: 5 };
const WORDS: readonly Stroke[] = [
  [
    { x: 0, y: 0 },
    { x: 0, y: 40 },
  ],
];

interface Seen {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

const sidecar = (
  health: unknown,
  read: (body: unknown) => Response | Promise<Response>,
  seen: Seen[] = [],
): FetchLike => {
  return async (url, init) => {
    seen.push({ url, init });
    if (url === `${SIDECAR}/health`) return Response.json(health);
    if (url === `${SIDECAR}/read`) return read(JSON.parse(String(init?.body)));
    return Response.json({ error: "no route" }, { status: 404 });
  };
};

const READS = { ok: true, capabilities: { eye: false, handwriting: true } };

describe("SidecarTranscriber", () => {
  it("is ready once the sidecar has a handwriting model and answers a read", async () => {
    const seen: Seen[] = [];
    const reader = new SidecarTranscriber(
      { url: SIDECAR, apiKey: "sidecar-key" },
      sidecar(READS, () => Response.json({ text: "HI" }), seen),
      FAST,
    );
    expect(reader.ready).toBe(false);
    expect(await reader.warmUp()).toBe(true);
    expect(reader.ready).toBe(true);
    expect(seen.map(({ url }) => url)).toEqual([`${SIDECAR}/health`, `${SIDECAR}/read`]);
    expect(new Headers(seen[1]?.init?.headers).get("authorization")).toBe("Bearer sidecar-key");
  });

  it("is not ready with a sidecar that cannot read, or none at all", async () => {
    const eyeOnly = { ok: true, classes: 345, model: "kami-eye" };
    const reads = () => Response.json({ text: null });
    expect(
      await new SidecarTranscriber({ url: SIDECAR }, sidecar(eyeOnly, reads), FAST).warmUp(),
    ).toBe(false);
    const down: FetchLike = async () => {
      throw new TypeError("connection refused");
    };
    expect(await new SidecarTranscriber({ url: SIDECAR }, down, FAST).warmUp()).toBe(false);
    const broken = sidecar(READS, () => Response.json({ error: "boom" }, { status: 500 }));
    expect(await new SidecarTranscriber({ url: SIDECAR }, broken, FAST).warmUp()).toBe(false);
  });

  it("waits for a sidecar that is still starting", async () => {
    let looks = 0;
    const starting: FetchLike = async (url, init) => {
      if (url.endsWith("/health")) looks += 1;
      if (url.endsWith("/health") && looks < 3) throw new TypeError("not yet");
      return sidecar(READS, () => Response.json({ text: "hi" }))(url, init);
    };
    expect(await new SidecarTranscriber({ url: SIDECAR }, starting, FAST).warmUp()).toBe(true);
    expect(looks).toBe(3);
  });

  it("sends the strokes and holds the answer to the shape of writing", async () => {
    const bodies: unknown[] = [];
    const answers = ["  no   gravity ", "IIII", null];
    const reader = new SidecarTranscriber(
      { url: SIDECAR },
      sidecar(READS, (body) => {
        bodies.push(body);
        return Response.json({ text: answers[bodies.length - 1] });
      }),
      FAST,
    );
    expect(await reader.transcribe(WORDS)).toBe("no gravity");
    expect(bodies[0]).toEqual({ strokes: WORDS });
    expect(await reader.transcribe(WORDS)).toBeNull();
    expect(await reader.transcribe(WORDS)).toBeNull();
    expect(await reader.transcribe([])).toBeNull();
  });

  it("is null, never a throw, when the sidecar fails or the pen moves on", async () => {
    const failing = new SidecarTranscriber(
      { url: SIDECAR },
      sidecar(READS, () => new Response("not json")),
      FAST,
    );
    expect(await failing.transcribe(WORDS)).toBeNull();
    const withdrawn = new AbortController();
    withdrawn.abort();
    const reader = new SidecarTranscriber(
      { url: SIDECAR },
      sidecar(READS, () => Response.json({ text: "hello" })),
      FAST,
    );
    expect(await reader.transcribe(WORDS, { signal: withdrawn.signal })).toBeNull();
  });
});
