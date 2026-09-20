import { describe, expect, it } from "vitest";
import { arenaBoard } from "./arena";

describe("arenaBoard", () => {
  it("fills the screen with a floor and edge walls", () => {
    const board = arenaBoard("arena", { width: 1000, height: 800 });
    expect(board.spawn).toEqual({ x: 0, y: 0 });
    expect(board.killY).toBe(1000);
    expect(board.solids).toEqual([
      { rect: { x: -500, y: 0, width: 1000, height: 36 }, material: "marker" },
      { rect: { x: -500, y: -1000, width: 24, height: 1000 }, material: "marker" },
      { rect: { x: 476, y: -1000, width: 24, height: 1000 }, material: "marker" },
    ]);
    expect(board.zones).toEqual([]);
    expect(board.noInkZones).toEqual([]);
  });
});
