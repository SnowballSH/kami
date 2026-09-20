import type { Governs, WorldPhysics } from "../../rules/types";

/** How one puzzle room is staged over its board: the dials it will take from the pen, the world it lays down, Kami's closing line. */
export interface PuzzleRoom {
  readonly boardId: string;
  readonly dials: readonly Governs[];
  readonly world: Partial<WorldPhysics>;
  readonly closing: string;
}

/** The rooms in the order they are played; every board in `PUZZLE_BOARDS` has one, and no other. */
export const PUZZLE_ROOMS: readonly PuzzleRoom[] = [
  {
    boardId: "puzzle-wall",
    dials: [],
    world: {},
    closing: "Over. Not through, not around. Over.",
  },
  {
    boardId: "puzzle-keyhole",
    dials: ["aliceSize"],
    world: {},
    closing: "Small enough, at last.",
  },
  {
    boardId: "puzzle-moon-ledge",
    dials: ["gravity"],
    world: {},
    closing: "Lighter. She'll miss that.",
  },
];

export const FIRST_PUZZLE_BOARD_ID = PUZZLE_ROOMS[0]?.boardId ?? "";

export const isPuzzleBoard = (boardId: string): boolean =>
  PUZZLE_ROOMS.some((room) => room.boardId === boardId);

/** Where a puzzle run opens: the room asked for, or the first when the board is not one of ours. */
export const puzzleBoardIdFor = (requested: string | null): string =>
  requested !== null && isPuzzleBoard(requested) ? requested : FIRST_PUZZLE_BOARD_ID;
