import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lockupSvg, markSvg, WORDMARK_TEXT, wordmarkSvg, writeWord } from "./logo";

interface ViewBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const viewBoxOf = (svg: string): ViewBox => {
  const match = /viewBox="([^"]+)"/.exec(svg);
  const [x, y, width, height] = (match?.[1] ?? "").split(" ").map(Number);
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    throw new Error("no viewBox");
  }
  return { x, y, width, height };
};

const pathCount = (svg: string): number => svg.split("<path").length - 1;

describe("brand logo", () => {
  it("writes the wordmark in Kami's hand, deterministically per seed", () => {
    expect(wordmarkSvg()).toBe(wordmarkSvg());
    expect(wordmarkSvg(1)).not.toBe(wordmarkSvg(2));
    expect(wordmarkSvg()).toContain(`aria-label="${WORDMARK_TEXT}"`);
  });

  it("crops the wordmark to its ink plus a margin", () => {
    const word = writeWord(WORDMARK_TEXT, 12);
    const { x, y, width, height } = viewBoxOf(wordmarkSvg(12));
    expect(x).toBeLessThan(word.bounds.x);
    expect(y).toBeLessThan(word.bounds.y);
    expect(width).toBeGreaterThan(word.bounds.width);
    expect(height).toBeGreaterThan(word.bounds.height);
    expect(width / height).toBeGreaterThan(2);
  });

  it("makes a square mark with paper, a baseline, the k and Alice", () => {
    const mark = markSvg();
    const { x, y, width, height } = viewBoxOf(mark);
    expect([x, y]).toEqual([0, 0]);
    expect(width).toBe(height);
    expect(mark).toContain("<rect");
    expect(mark).toContain("<circle");
    expect(pathCount(mark)).toBeGreaterThanOrEqual(3);
    expect(mark).toBe(markSvg());
  });

  it("nests the mark beside the wordmark in the lockup", () => {
    const lockup = lockupSvg();
    expect(lockup.match(/<svg/g)?.length).toBe(1);
    expect(lockup).toContain("<g transform=");
    expect(lockup).toContain("<rect");
    expect(pathCount(lockup)).toBe(pathCount(markSvg()) + pathCount(wordmarkSvg()));
  });

  it("keeps the committed assets in step with the generator", () => {
    const read = (...path: readonly string[]): string =>
      readFileSync(join(process.cwd(), ...path), "utf8");
    expect(read("src/brand/assets/kami-wordmark.svg")).toBe(wordmarkSvg());
    expect(read("src/brand/assets/kami-mark.svg")).toBe(markSvg());
    expect(read("src/brand/assets/kami-lockup.svg")).toBe(lockupSvg());
    expect(read("public/kami-mark.svg")).toBe(markSvg());
  });
});
