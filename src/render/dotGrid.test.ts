import { describe, expect, it } from "vitest";
import { visibleWorld } from "./camera";
import { DOT_GRID, dotGridLayout, dotSpacing } from "./dotGrid";

const BOX = { width: 1366, height: 1024 };

describe("dotSpacing", () => {
  it("is the base grid at and above full size", () => {
    expect(dotSpacing(1)).toBe(DOT_GRID.spacing);
    expect(dotSpacing(4)).toBe(DOT_GRID.spacing);
  });

  it("thins out as the camera zooms away, then stops altogether", () => {
    expect(dotSpacing(0.5)).toBe(DOT_GRID.spacing * 2);
    expect(dotSpacing(0.3)).toBe(DOT_GRID.spacing * 4);
    expect(dotSpacing(0.25)).toBeNull();
    expect(dotSpacing(Number.NaN)).toBeNull();
  });

  it.each([0.3, 0.37, 0.5, 0.74, 1, 2.5, 4])("never crowds the screen at zoom %s", (zoom) => {
    const spacing = dotSpacing(zoom) ?? 0;
    expect(spacing * zoom).toBeGreaterThanOrEqual(DOT_GRID.minScreenGap);
  });
});

describe("dotGridLayout", () => {
  it("pins dots to the world so they do not swim when the camera pans", () => {
    const layout = dotGridLayout(
      visibleWorld({ center: { x: 1234.5, y: -77 }, zoom: 1, angle: 0 }, BOX),
      1,
    );
    expect(layout).not.toBeNull();
    if (layout === null) return;
    expect(layout.firstX % layout.spacing).toBeCloseTo(0);
    expect(layout.firstY % layout.spacing).toBeCloseTo(0);
  });

  it("covers the view and nothing more", () => {
    const view = visibleWorld({ center: { x: 310, y: 95 }, zoom: 0.6, angle: 0 }, BOX);
    const layout = dotGridLayout(view, 0.6);
    expect(layout).not.toBeNull();
    if (layout === null) return;
    const lastX = layout.firstX + (layout.columns - 1) * layout.spacing;
    const lastY = layout.firstY + (layout.rows - 1) * layout.spacing;
    expect(layout.firstX).toBeGreaterThanOrEqual(view.x);
    expect(layout.firstX - layout.spacing).toBeLessThan(view.x);
    expect(lastX).toBeLessThanOrEqual(view.x + view.width);
    expect(lastX + layout.spacing).toBeGreaterThan(view.x + view.width);
    expect(lastY).toBeLessThanOrEqual(view.y + view.height);
    expect(layout.columns * layout.rows).toBeLessThan(2000);
  });
});
