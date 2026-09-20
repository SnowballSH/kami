import { describe, expect, it } from "vitest";
import { boundsOf, rectsOverlap } from "../core/geometry";
import { fitSketch, layoutBoxes, placeProp, SUMMONED_SIZE, sizeOf } from "./layout";

describe("sizeOf", () => {
  it("knows big things from small ones and calls the rest usual", () => {
    expect(sizeOf("house")).toBe("big");
    expect(sizeOf("key")).toBe("small");
    expect(sizeOf("rabbit")).toBe("usual");
  });
});

describe("fitSketch", () => {
  it("scales a dataset sketch into its box, keeping its shape, standing on the floor", () => {
    const wide = [
      [
        { x: 0, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 150 },
      ],
    ];
    const fitted = fitSketch(wide, { x: 300, y: 500, width: 100, height: 100 });
    expect(boundsOf(fitted.flat())).toEqual({ x: 300, y: 575, width: 100, height: 25 });
    expect(fitted[0]?.[1]).toEqual({ x: 400, y: 575 });
  });

  it("centres a tall sketch in a square box", () => {
    const tall = [
      [
        { x: 10, y: 0 },
        { x: 10, y: 255 },
      ],
      [
        { x: 0, y: 255 },
        { x: 20, y: 255 },
      ],
    ];
    const fitted = fitSketch(tall, { x: 0, y: 0, width: 110, height: 110 });
    const bounds = boundsOf(fitted.flat());
    expect(bounds.height).toBeCloseTo(110);
    expect(bounds.x + bounds.width / 2).toBeCloseTo(55);
    expect(bounds.y).toBeCloseTo(0);
  });

  it("does not blow up a single dot", () => {
    const dot = [[{ x: 5, y: 5 }]];
    const [stroke] = fitSketch(dot, { x: 0, y: 0, width: 50, height: 50 });
    expect(stroke?.[0]?.x).toBeCloseTo(25);
    expect(stroke?.[0]?.y).toBeCloseTo(50);
  });
});

describe("layoutBoxes", () => {
  it("lines things up rightwards from the origin, standing on one floor", () => {
    const [small, big, usual] = layoutBoxes(["small", "big", "usual"], { x: 100, y: 200 });
    expect(small).toMatchObject({ x: 100, width: SUMMONED_SIZE.small });
    expect(big).toMatchObject({ width: SUMMONED_SIZE.big, height: SUMMONED_SIZE.big });
    expect(usual).toMatchObject({ width: SUMMONED_SIZE.usual });
    const floors = [small, big, usual].map((box) => (box?.y ?? 0) + (box?.height ?? 0));
    expect(new Set(floors).size).toBe(1);
    expect(floors[0]).toBe(200 + SUMMONED_SIZE.big);
    expect(big?.x).toBeGreaterThan((small?.x ?? 0) + (small?.width ?? 0));
    expect(usual?.x).toBeGreaterThan((big?.x ?? 0) + (big?.width ?? 0));
  });

  it("starts a second row below after four", () => {
    const boxes = layoutBoxes(
      Array.from({ length: 6 }, () => "usual" as const),
      { x: 0, y: 0 },
    );
    expect(boxes).toHaveLength(6);
    expect(boxes[4]?.x).toBe(0);
    expect(boxes[4]?.y).toBeGreaterThan((boxes[0]?.y ?? 0) + (boxes[0]?.height ?? 0));
    expect(boxes[5]?.y).toBe(boxes[4]?.y);
  });

  it("is empty for nothing", () => {
    expect(layoutBoxes([], { x: 0, y: 0 })).toEqual([]);
  });
});

describe("placeProp", () => {
  const picture = [
    [
      { x: 0, y: 128 },
      { x: 255, y: 128 },
    ],
    [
      { x: 128, y: 100 },
      { x: 128, y: 156 },
    ],
  ];
  const writing = { x: 300, y: 500, width: 120, height: 30 };

  it("scales the picture by the prop's size and centres it where the scene put it", () => {
    const placed = placeProp(picture, writing, { at: { x: -100, y: -200 }, size: 0.5 }, null);
    const bounds = boundsOf(placed.flat());
    expect(bounds.width).toBeCloseTo(SUMMONED_SIZE.usual / 2);
    expect(bounds.x + bounds.width / 2).toBeCloseTo(260);
    expect(bounds.y + bounds.height / 2).toBeCloseTo(300);
    expect(placed.map((stroke) => stroke.length)).toEqual([2, 2]);
  });

  it("lifts the prop clear of Alice when she stands where it would land", () => {
    const alice = { x: 340, y: 420, width: 28, height: 60 };
    const placed = placeProp(picture, writing, { at: { x: 0, y: -60 }, size: 1 }, alice);
    const bounds = boundsOf(placed.flat());
    expect(rectsOverlap(bounds, alice)).toBe(false);
    expect(bounds.y + bounds.height).toBeLessThan(alice.y);
  });
});
