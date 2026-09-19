import { describe, expect, it } from "vitest";
import { INK_THICKNESS } from "../core/world";
import type { Drawing, DrawingId } from "../ink/types";
import { fitThumbnail, inkBounds } from "./thumbnail";
import { toScreen } from "./viewport";

const drawingOf = (strokes: Drawing["strokes"]): Drawing => ({
  id: "test" as DrawingId,
  strokes,
  cost: 0,
});

const SIZE = 200;

describe("thumbnail fit", () => {
  it("bounds the ink, not just its spine", () => {
    const bounds = inkBounds(
      drawingOf([
        [
          { x: 100, y: 100 },
          { x: 500, y: 300 },
        ],
      ]),
    );
    expect(bounds).toEqual({
      x: 100 - INK_THICKNESS / 2,
      y: 100 - INK_THICKNESS / 2,
      width: 400 + INK_THICKNESS,
      height: 200 + INK_THICKNESS,
    });
  });

  it("has nothing to bound in an empty drawing", () => {
    expect(inkBounds(drawingOf([]))).toBeNull();
  });

  it("centres a wide drawing inside the padded square", () => {
    const bounds = { x: 300, y: 500, width: 400, height: 100 };
    const fit = fitThumbnail(bounds, SIZE);
    const topLeft = toScreen(fit, { x: bounds.x, y: bounds.y });
    const bottomRight = toScreen(fit, { x: bounds.x + bounds.width, y: bounds.y + bounds.height });
    expect(topLeft.x).toBeCloseTo(SIZE - bottomRight.x, 9);
    expect(topLeft.y).toBeCloseTo(SIZE - bottomRight.y, 9);
    expect(topLeft.x).toBeGreaterThan(0);
    expect(bottomRight.x - topLeft.x).toBeLessThan(SIZE);
  });

  it("does not blow a dot up to fill the frame", () => {
    const dot = inkBounds(drawingOf([[{ x: 50, y: 50 }]]));
    expect(dot).not.toBeNull();
    if (dot === null) return;
    const fit = fitThumbnail(dot, SIZE);
    expect(dot.width * fit.scale).toBeLessThan(SIZE / 2);
    expect(toScreen(fit, { x: 50, y: 50 })).toEqual({ x: SIZE / 2, y: SIZE / 2 });
  });
});
