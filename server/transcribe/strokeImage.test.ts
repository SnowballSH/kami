// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Stroke } from "../../src/core/geometry";
import { renderStrokes, strokesToPngDataUrl } from "./strokeImage";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const readUint32 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] ?? 0) << 24) |
  ((bytes[at + 1] ?? 0) << 16) |
  ((bytes[at + 2] ?? 0) << 8) |
  (bytes[at + 3] ?? 0);

const WORD: readonly Stroke[] = [
  [
    { x: 100, y: 200 },
    { x: 100, y: 260 },
  ],
  [
    { x: 100, y: 230 },
    { x: 140, y: 230 },
  ],
  [
    { x: 140, y: 200 },
    { x: 140, y: 260 },
  ],
];

describe("renderStrokes", () => {
  it("fits the writing to a fixed line height with a margin around it", () => {
    const canvas = renderStrokes(WORD);
    expect(canvas.height).toBe(64 + 32);
    expect(canvas.width).toBeLessThan(canvas.height);
    const darkPixels = canvas.pixels.filter((value) => value < 128).length;
    expect(darkPixels).toBeGreaterThan(100);
    expect(darkPixels).toBeLessThan(canvas.pixels.length / 4);
  });

  it("paints the stroke, not the margin", () => {
    const canvas = renderStrokes(WORD);
    const at = (x: number, y: number): number => canvas.pixels[y * canvas.width + x] ?? -1;
    expect(at(0, 0)).toBe(255);
    expect(at(16, canvas.height / 2)).toBeLessThan(128);
  });

  it("draws nothing at all as a small blank page", () => {
    const canvas = renderStrokes([]);
    expect(canvas.width).toBe(32);
    expect(canvas.height).toBe(32);
    expect(canvas.pixels.every((value) => value === 255)).toBe(true);
  });

  it("keeps a wide line of text within the maximum width", () => {
    const wide: Stroke = Array.from({ length: 200 }, (_, i) => ({
      x: i * 20,
      y: Math.sin(i) * 30,
    }));
    const canvas = renderStrokes([wide]);
    expect(canvas.width).toBeLessThanOrEqual(1024);
    expect(canvas.height).toBeGreaterThanOrEqual(32);
  });
});

describe("strokesToPngDataUrl", () => {
  it("encodes a PNG whose header matches the canvas", () => {
    const url = strokesToPngDataUrl(WORD);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    const bytes = new Uint8Array(Buffer.from(url.slice("data:image/png;base64,".length), "base64"));
    expect([...bytes.slice(0, 8)]).toEqual(PNG_SIGNATURE);
    const canvas = renderStrokes(WORD);
    expect(readUint32(bytes, 16)).toBe(canvas.width);
    expect(readUint32(bytes, 20)).toBe(canvas.height);
  });
});
