import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { animatedGif, WORDMARK_GIF } from "./gif";
import {
  aliceSvg,
  lockupSvg,
  markSvg,
  sumikuiSvg,
  WORDMARK_FRAMES,
  WORDMARK_TEXT,
  wordmarkFrames,
  wordmarkSvg,
  writeWord,
} from "./logo";

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

  it("stands Alice in for the i's stem and perches the Sumikui as its dot", () => {
    const svg = wordmarkSvg(12);
    const letters = writeWord("kam", 12);
    const word = writeWord(WORDMARK_TEXT, 12);
    const [stem] = word.strokes.slice(letters.strokes.length);
    if (stem === undefined) throw new Error("the i needs a stem");
    const stemHeight = Math.max(...stem.map((p) => p.y)) - Math.min(...stem.map((p) => p.y));
    expect(pathCount(svg)).toBe(
      1 + pathCount(aliceSvg({ x: 0, y: 0 }, 1)) + pathCount(sumikuiSvg({ x: 0, y: 0 }, 1)),
    );
    const translate = /translate\(([\d.]+) [\d.-]+\) scale\(([\d.]+)\)/.exec(svg);
    const aliceX = Number(translate?.[1]);
    const scale = Number(translate?.[2]);
    expect(aliceX).toBeGreaterThan(letters.bounds.x + letters.bounds.width);
    expect(scale * 57.5).toBeCloseTo(stemHeight, 0);
    expect(stemHeight).toBeLessThan(letters.bounds.height);
    expect(svg).toContain("<circle");
  });

  it("animates only the Sumikui across one breath of frames", () => {
    const frames = wordmarkFrames();
    expect(frames).toHaveLength(WORDMARK_FRAMES);
    expect(frames[0]).toBe(wordmarkSvg());
    expect(new Set(frames).size).toBe(WORDMARK_FRAMES);
    const letters = (svg: string) => svg.split("<path")[1];
    expect(new Set(frames.map(letters)).size).toBe(1);
    const viewBoxes = new Set(frames.map((svg) => JSON.stringify(viewBoxOf(svg))));
    expect(viewBoxes.size).toBe(1);
  });

  it("encodes the frames as a looping GIF", () => {
    const gif = animatedGif(wordmarkFrames(12, 3), { width: 96, frameMs: 80, background: "#fff" });
    expect(String.fromCharCode(...gif.subarray(0, 6))).toBe("GIF89a");
    expect(gif.at(-1)).toBe(0x3b);
    expect(gif.length).toBeGreaterThan(200);
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
    expect(readFileSync(join(process.cwd(), "src/brand/assets/kami-wordmark.gif"))).toEqual(
      Buffer.from(animatedGif(wordmarkFrames(), WORDMARK_GIF)),
    );
  });
});
