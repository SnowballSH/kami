import { describe, expect, it } from "vitest";
import { INPUT_LIMITS } from "../core/inputLimits";
import type { FetchLike } from "./api";
import { HttpHandwritingReader } from "./httpHandwritingReader";

const STROKES = [
  [
    { x: 0, y: 0 },
    { x: 0, y: 40 },
  ],
  [
    { x: 0, y: 20 },
    { x: 20, y: 20 },
  ],
];

describe("HttpHandwritingReader", () => {
  it("bounds sketch requests and transcribed text before use", async () => {
    let calls = 0;
    const reader = new HttpHandwritingReader(async () => {
      calls++;
      return Response.json({ text: "x".repeat(INPUT_LIMITS.text + 1) });
    });
    const strokes = Array.from({ length: INPUT_LIMITS.strokes + 1 }, () => [{ x: 0, y: 0 }]);
    expect(await reader.read(strokes)).toBeNull();
    expect(calls).toBe(0);
    expect(await reader.read(STROKES)).toBeNull();
    expect(calls).toBe(1);
  });

  it("posts the strokes and returns the words the server read", async () => {
    const seen: { path: string; method: string | undefined; body: unknown }[] = [];
    const reader = new HttpHandwritingReader(async (path, init) => {
      seen.push({ path, method: init?.method, body: JSON.parse(String(init?.body)) });
      return Response.json({ text: "no gravity" });
    });
    expect(await reader.read(STROKES)).toBe("no gravity");
    expect(seen).toEqual([{ path: "/api/transcribe", method: "POST", body: { strokes: STROKES } }]);
  });

  it("hands the caller's abort signal on to the request", async () => {
    const controller = new AbortController();
    let signal: AbortSignal | null | undefined;
    const reader = new HttpHandwritingReader(async (_path, init) => {
      signal = init?.signal;
      return Response.json({ text: "hi" });
    });
    await reader.read(STROKES, { signal: controller.signal });
    expect(signal?.aborted).toBe(false);
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });

  it.each<[string, FetchLike]>([
    ["a drawing", async () => Response.json({ text: null })],
    ["an empty reading", async () => Response.json({ text: "" })],
    ["no reader on the server", async () => new Response("no", { status: 501 })],
    ["a shape it does not know", async () => Response.json({ words: "hi" })],
    ["a network that is down", async () => Promise.reject(new TypeError("Failed to fetch"))],
    ["not JSON", async () => new Response("<html>", { status: 200 })],
  ])("reads nothing from %s", async (_name, fetchFn) => {
    expect(await new HttpHandwritingReader(fetchFn).read(STROKES)).toBeNull();
  });
});
