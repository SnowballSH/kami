import { describe, expect, it } from "vitest";
import {
  boardFor,
  DEMO_BOARD_ID,
  ENDLESS_CLEARING,
  ENDLESS_GROUND,
  ENDLESS_HIGH_GROUNDS,
  endlessBoard,
  groundSolids,
  isEndless,
  pageFor,
} from ".";

describe("an endless page", () => {
  it("is a floor under the spawn with things to draw against: no goal, key, door, zones or bottom", () => {
    const page = endlessBoard("together");
    expect(page.id).toBe("together");
    expect(page.page).toBe("endless");
    expect(page.goal).toBeUndefined();
    expect(page.key).toBeUndefined();
    expect(page.door).toBeUndefined();
    expect(page.zones).toEqual([]);
    expect(page.noInkZones).toEqual([]);
    expect(page.killY).toBe(Number.POSITIVE_INFINITY);
    expect(page.solids[0]).toEqual({ rect: ENDLESS_GROUND, material: "marker" });
    expect(page.solids.every((solid) => solid.material === "marker")).toBe(true);
    expect(page.spawn.y).toBe(ENDLESS_GROUND.y);
    expect(page.spawn.x).toBeGreaterThan(ENDLESS_GROUND.x);
    expect(page.spawn.x).toBeLessThan(ENDLESS_GROUND.x + ENDLESS_GROUND.width);
  });

  it("is a very wide floor with high grounds standing on it, none of them near the spawn", () => {
    const floorEnd = ENDLESS_GROUND.x + ENDLESS_GROUND.width;
    expect(ENDLESS_GROUND.width).toBeGreaterThanOrEqual(10_000);
    expect(ENDLESS_HIGH_GROUNDS.length).toBeGreaterThanOrEqual(8);
    for (const high of ENDLESS_HIGH_GROUNDS) {
      expect(high.y).toBeLessThan(ENDLESS_GROUND.y);
      expect(high.y + high.height).toBeLessThanOrEqual(ENDLESS_GROUND.y);
      expect(high.x).toBeGreaterThanOrEqual(ENDLESS_GROUND.x);
      expect(high.x + high.width).toBeLessThanOrEqual(floorEnd);
      expect(Math.min(Math.abs(high.x), Math.abs(high.x + high.width))).toBeGreaterThanOrEqual(
        ENDLESS_CLEARING,
      );
    }
    const bars = ENDLESS_HIGH_GROUNDS.filter((high) => high.width <= 100 && high.height >= 200);
    expect(bars.length).toBeGreaterThanOrEqual(3);
  });

  it("is what any id becomes under an endless mode, even the demo room's", () => {
    expect(pageFor("endless", DEMO_BOARD_ID).page).toBe("endless");
    expect(pageFor("room", DEMO_BOARD_ID)).toBe(boardFor(DEMO_BOARD_ID));
    expect(isEndless(pageFor("endless", "x"))).toBe(true);
    expect(isEndless(boardFor("x"))).toBe(false);
    expect(isEndless(boardFor(DEMO_BOARD_ID))).toBe(false);
  });

  it("keeps only ground-level solids available for beneath-ground placement", () => {
    const board = boardFor(DEMO_BOARD_ID);
    const grounds = groundSolids(board);
    expect(grounds).toContainEqual(board.solids.find(({ rect }) => rect.x === -2000)?.rect);
    expect(grounds).not.toContainEqual({ x: 420, y: 400, width: 140, height: 24 });
  });
});
