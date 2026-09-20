import { describe, expect, it } from "vitest";
import { strokesSchema, textSchema, vecSchema } from "./input";
import { INPUT_LIMITS } from "./inputLimits";
import { BodyTooLargeError, readBoundedText } from "./readBody";

const point = { x: INPUT_LIMITS.coordinate, y: -INPUT_LIMITS.coordinate };
const stroke = Array.from({ length: INPUT_LIMITS.pointsPerStroke }, () => point);

describe("input budgets", () => {
  it("accepts the exact aggregate, stroke, coordinate and text limits", () => {
    expect(strokesSchema.safeParse([stroke, stroke]).success).toBe(true);
    expect(
      strokesSchema.safeParse(Array.from({ length: INPUT_LIMITS.strokes }, () => [point])).success,
    ).toBe(true);
    expect(textSchema.safeParse("x".repeat(INPUT_LIMITS.text)).success).toBe(true);
    expect(textSchema.safeParse("😀".repeat(INPUT_LIMITS.text / 2)).success).toBe(true);
  });

  it("rejects the aggregate before inspecting any point", () => {
    const unreadable = {
      get x(): number {
        throw new Error("must not inspect points");
      },
      y: 0,
    };
    const full = Array.from({ length: INPUT_LIMITS.pointsPerStroke }, () => unreadable);
    const result = strokesSchema.safeParse([full, full, [unreadable]]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toContain("points per drawing");
  });

  it("rejects each individual limit plus nonfinite coordinates", () => {
    expect(
      strokesSchema.safeParse([...Array.from({ length: INPUT_LIMITS.strokes }, () => []), []])
        .success,
    ).toBe(false);
    expect(strokesSchema.safeParse([[...stroke, point]]).success).toBe(false);
    for (const x of [INPUT_LIMITS.coordinate + 1, -INPUT_LIMITS.coordinate - 1, Infinity, NaN])
      expect(vecSchema.safeParse({ x, y: 0 }).success).toBe(false);
    expect(textSchema.safeParse(`${"x".repeat(INPUT_LIMITS.text)}!`).success).toBe(false);
  });

  it("fits maximal JSON number representations and escaped text in the wire envelopes", () => {
    const precise = { x: -0.0000012345678901234567, y: -0.0000012345678901234567 };
    const strokes = Array.from({ length: INPUT_LIMITS.strokes }, () =>
      Array.from({ length: INPUT_LIMITS.points / INPUT_LIMITS.strokes }, () => precise),
    );
    expect(new TextEncoder().encode(JSON.stringify({ strokes })).byteLength).toBeLessThan(
      INPUT_LIMITS.sketchBytes,
    );
    expect(
      new TextEncoder().encode(JSON.stringify({ text: "\0".repeat(INPUT_LIMITS.text) })).byteLength,
    ).toBeLessThan(INPUT_LIMITS.textBytes);
  });
});

describe("bounded bodies", () => {
  it("counts UTF-8 bytes rather than characters at the exact boundary", async () => {
    await expect(readBoundedText(new Response("éé"), 4)).resolves.toBe("éé");
    await expect(readBoundedText(new Response("ééx"), 4)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("rejects a declared oversized body without reading it", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      readBoundedText(new Response(body, { headers: { "content-length": "10" } }), 4),
    ).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(cancelled).toBe(true);
  });

  it.each([undefined, "1"])("counts chunked bodies even with content-length %s", async (length) => {
    let cancelled = false;
    let chunks = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks++;
        controller.enqueue(new TextEncoder().encode("éé"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const headers = length === undefined ? {} : { "content-length": length };
    await expect(readBoundedText(new Response(body, { headers }), 4)).rejects.toBeInstanceOf(
      BodyTooLargeError,
    );
    expect(cancelled).toBe(true);
    expect(chunks).toBeLessThanOrEqual(3);
  });
});
