import { blankBoard } from "./boards/blank";
import { PUZZLE_BOARDS } from "./boards/puzzles";
import { wonderland } from "./boards/wonderland";
import type { BoardDefinition } from "./types";

export { PUZZLE_BOARDS } from "./boards/puzzles";
export type * from "./types";

export const DEMO_BOARD_ID = wonderland.id;

const SKETCHED: ReadonlyMap<string, BoardDefinition> = new Map(
  [wonderland, ...PUZZLE_BOARDS].map((board) => [board.id, board]),
);

export const boardFor = (id: string): BoardDefinition => SKETCHED.get(id) ?? blankBoard(id);
