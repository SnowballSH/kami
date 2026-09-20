import { describe, expect, it } from "vitest";
import { DEMO_BOARD_ID } from "../board";
import { EMBODIED_MODE, FIRST_PUZZLE_BOARD_ID, PUZZLE_MODE, SANDBOX_MODE } from "../modes";
import { boardInUrl, modeInUrl, SHARED_PAGE_ID, shareLink } from "./launch";

describe("starting from the address bar", () => {
  it("plays sandbox on `?mode=sandbox` and today's game otherwise", () => {
    expect(modeInUrl("?mode=sandbox")).toBe(SANDBOX_MODE);
    expect(modeInUrl("?board=x&mode=sandbox")).toBe(SANDBOX_MODE);
    expect(modeInUrl("?mode=puzzle")).toBe(PUZZLE_MODE);
    expect(modeInUrl("")).toBe(EMBODIED_MODE);
    expect(modeInUrl("?mode=nonsense")).toBe(EMBODIED_MODE);
  });

  it("opens the board named, else the demo room, else the one shared endless page", () => {
    expect(boardInUrl("?board=ours", SANDBOX_MODE)).toBe("ours");
    expect(boardInUrl("?board=ours", EMBODIED_MODE)).toBe("ours");
    expect(boardInUrl("", EMBODIED_MODE)).toBe(DEMO_BOARD_ID);
    expect(boardInUrl("?mode=sandbox", SANDBOX_MODE)).toBe(SHARED_PAGE_ID);
  });

  it("opens the puzzle run at its first room, or at the room named", () => {
    expect(boardInUrl("?mode=puzzle", PUZZLE_MODE)).toBe(FIRST_PUZZLE_BOARD_ID);
    expect(boardInUrl("?mode=puzzle&board=wonderland", PUZZLE_MODE)).toBe(FIRST_PUZZLE_BOARD_ID);
    expect(boardInUrl("?mode=puzzle&board=puzzle-shaft", PUZZLE_MODE)).toBe("puzzle-shaft");
  });

  it("writes a share link that carries only the board and the mode", () => {
    const link = shareLink("http://192.168.1.4:5173/?autopilot=on#x", "ours", SANDBOX_MODE);
    expect(link).toBe("http://192.168.1.4:5173/?board=ours&mode=sandbox");
  });
});
