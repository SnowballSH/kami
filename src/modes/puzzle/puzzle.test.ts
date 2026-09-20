import { describe, expect, it } from "vitest";
import { boardFor, PUZZLE_BOARDS } from "../../board";
import { EARTH } from "../../rules/types";
import { createDirector } from "../director";
import { EMBODIED_MODE, modeFor } from "../modes";
import { allowsLaw } from "../policy";
import { PUZZLE_MODE, PUZZLE_MODE_ID } from "./mode";
import { PuzzleDirector } from "./puzzleDirector";
import { FIRST_PUZZLE_BOARD_ID, isPuzzleBoard, PUZZLE_ROOMS, puzzleBoardIdFor } from "./rooms";

const opened = (boardId: string): PuzzleDirector => {
  const director = new PuzzleDirector(PUZZLE_MODE);
  director.open(boardFor(boardId));
  return director;
};

describe("puzzle mode", () => {
  it("is chosen by `?mode=puzzle` and refereed by its own director", () => {
    expect(modeFor("puzzle")).toBe(PUZZLE_MODE);
    expect(PUZZLE_MODE.id).toBe(PUZZLE_MODE_ID);
    expect(createDirector(PUZZLE_MODE)).toBeInstanceOf(PuzzleDirector);
    expect(createDirector(EMBODIED_MODE)).not.toBeInstanceOf(PuzzleDirector);
  });

  it("plays every puzzle board once, in order, and opens on the first unless a room is named", () => {
    expect(PUZZLE_ROOMS.map((room) => room.boardId)).toEqual(
      PUZZLE_BOARDS.map((board) => board.id),
    );
    expect(PUZZLE_ROOMS).toHaveLength(3);
    expect(puzzleBoardIdFor(null)).toBe(FIRST_PUZZLE_BOARD_ID);
    expect(puzzleBoardIdFor("wonderland")).toBe(FIRST_PUZZLE_BOARD_ID);
    expect(puzzleBoardIdFor("puzzle-unknown")).toBe(FIRST_PUZZLE_BOARD_ID);
    expect(isPuzzleBoard("puzzle-unknown")).toBe(false);
    expect(isPuzzleBoard("wonderland")).toBe(false);
  });

  it("narrows every room to one nature or none, so the drawn idea is the only one that takes", () => {
    for (const board of PUZZLE_BOARDS) {
      const [zone] = board.zones;
      expect(zone?.allowedNatures).not.toBe("all");
      expect(zone?.allowedNatures?.length ?? 0).toBeLessThanOrEqual(1);
      expect(zone?.intro).not.toBe("");
      expect(zone?.hints.length).toBeGreaterThan(0);
    }
  });
});

describe("the puzzle director", () => {
  it("stages each room with the Sumikui loose over the room's world, and only the room's dials writable", () => {
    const { room } = opened("puzzle-moon-ledge");
    if (room === null) throw new Error("not staged");
    expect(room.world).toEqual({ ...EARTH, inkEater: 1 });
    expect(allowsLaw(room.laws, "inkEater")).toBe(true);
    expect(allowsLaw(room.laws, "gravity")).toBe(true);
    expect(allowsLaw(room.laws, "daylight")).toBe(false);
  });

  it("cards each room with its title, intro and place in the run, and chains to the next", () => {
    const [first, second] = PUZZLE_ROOMS;
    if (first === undefined || second === undefined) throw new Error("no rooms");
    const { room } = opened(first.boardId);
    expect(room?.card).toEqual({
      mode: "Puzzle",
      title: boardFor(first.boardId).title,
      line: boardFor(first.boardId).zones[0]?.intro,
      mark: `room 1 of ${PUZZLE_ROOMS.length}`,
    });
    expect(room?.closing).toBe(first.closing);
    expect(room?.next).toBe(second.boardId);

    const last = PUZZLE_ROOMS.at(-1);
    if (last === undefined) throw new Error("no rooms");
    expect(opened(last.boardId).room?.next).toBeNull();
  });

  it("stages nothing on a board that is not a puzzle room, and still opens with a body", () => {
    const director = opened("wonderland");
    expect(director.room).toBeNull();
    expect(director.state).toEqual({ kind: "body" });
    expect(director.won({ type: "goal-reached", who: 0 })).toBe(true);
  });
});
