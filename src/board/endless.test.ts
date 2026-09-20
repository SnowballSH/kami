import { describe, expect, it } from "vitest";
import { boardFor, DEMO_BOARD_ID, ENDLESS_GROUND, endlessBoard, isEndless, pageFor } from ".";

describe("an endless page", () => {
  it("is a strip of ground under the spawn and nothing else: no goal, key, door, zones or bottom", () => {
    const page = endlessBoard("together");
    expect(page.id).toBe("together");
    expect(page.page).toBe("endless");
    expect(page.goal).toBeUndefined();
    expect(page.key).toBeUndefined();
    expect(page.door).toBeUndefined();
    expect(page.zones).toEqual([]);
    expect(page.noInkZones).toEqual([]);
    expect(page.killY).toBe(Number.POSITIVE_INFINITY);
    expect(page.solids).toEqual([{ rect: ENDLESS_GROUND, material: "marker" }]);
    expect(page.spawn.y).toBe(ENDLESS_GROUND.y);
    expect(page.spawn.x).toBeGreaterThan(ENDLESS_GROUND.x);
    expect(page.spawn.x).toBeLessThan(ENDLESS_GROUND.x + ENDLESS_GROUND.width);
  });

  it("is what any id becomes under an endless mode, even the demo room's", () => {
    expect(pageFor("endless", DEMO_BOARD_ID).page).toBe("endless");
    expect(pageFor("room", DEMO_BOARD_ID)).toBe(boardFor(DEMO_BOARD_ID));
    expect(isEndless(pageFor("endless", "x"))).toBe(true);
    expect(isEndless(boardFor("x"))).toBe(false);
    expect(isEndless(boardFor(DEMO_BOARD_ID))).toBe(false);
  });
});
