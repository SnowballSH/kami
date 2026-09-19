import { describe, expect, it } from "vitest";
import type { Rect } from "../core/geometry";
import { countAnchorClusters, resample } from "./anchoring";

const LEFT_BANK: Rect = { x: 0, y: 560, width: 380, height: 200 };
const RIGHT_BANK: Rect = { x: 600, y: 560, width: 250, height: 200 };
const BANKS = [LEFT_BANK, RIGHT_BANK];

describe("resample", () => {
  it("fills long gaps and keeps the endpoints", () => {
    const dense = resample(
      [
        { x: 0, y: 0 },
        { x: 80, y: 0 },
      ],
      8,
    );
    expect(dense).toHaveLength(11);
    expect(dense.at(0)).toEqual({ x: 0, y: 0 });
    expect(dense.at(-1)).toEqual({ x: 80, y: 0 });
  });
});

describe("countAnchorClusters", () => {
  it("finds two anchors for a bridge resting on both banks, even from two points", () => {
    const bridge = [
      { x: 370, y: 556 },
      { x: 610, y: 556 },
    ];
    expect(countAnchorClusters([bridge], BANKS)).toBe(2);
  });

  it("finds one anchor for a post stood on a bank", () => {
    const post = [
      { x: 200, y: 555 },
      { x: 200, y: 400 },
    ];
    expect(countAnchorClusters([post], BANKS)).toBe(1);
  });

  it("finds none for ink hanging over the ditch", () => {
    const plank = [
      { x: 420, y: 500 },
      { x: 560, y: 500 },
    ];
    expect(countAnchorClusters([plank], BANKS)).toBe(0);
  });
});
