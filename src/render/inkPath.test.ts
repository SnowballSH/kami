import { getStroke } from "perfect-freehand";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PenPoint } from "../core/geometry";
import { INK_PEN, strokesPath } from "./inkPath";

vi.mock("perfect-freehand", async (original) => {
  const actual = await original<typeof import("perfect-freehand")>();
  return { ...actual, getStroke: vi.fn(actual.getStroke) };
});

class SilentPath2D {
  moveTo(): void {}
  arc(): void {}
  quadraticCurveTo(): void {}
  closePath(): void {}
}

const wave = (shift: number): PenPoint[] =>
  Array.from({ length: 12 }, (_, index) => ({ x: index * 4 + shift, y: Math.sin(index) * 8 }));

beforeEach(() => {
  vi.stubGlobal("Path2D", SilentPath2D);
  vi.mocked(getStroke).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("strokesPath outline reuse", () => {
  it("traces a stroke it has seen only once", () => {
    const strokes = [wave(0), wave(10), wave(20)];
    strokesPath(strokes, INK_PEN);
    strokesPath(strokes, INK_PEN);
    strokesPath([...strokes], INK_PEN);
    expect(getStroke).toHaveBeenCalledTimes(3);
  });

  it("retraces only the stroke still growing under the pen", () => {
    const growing = wave(40);
    const strokes = [wave(0), wave(10), growing];
    strokesPath(strokes, INK_PEN);
    vi.mocked(getStroke).mockClear();

    growing.push({ x: 100, y: 3 });
    strokesPath(strokes, INK_PEN);

    expect(getStroke).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getStroke).mock.calls[0]?.[0]).toHaveLength(growing.length);
  });

  it("traces the same stroke afresh for a different pen", () => {
    const stroke = wave(0);
    strokesPath([stroke], INK_PEN);
    strokesPath([stroke], { ...INK_PEN, size: INK_PEN.size * 2 });
    expect(getStroke).toHaveBeenCalledTimes(2);
  });
});
