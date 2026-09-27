import { blankBoard } from "./boards/blank";
import { PUZZLE_BOARDS } from "./boards/puzzles";
import { wonderland } from "./boards/wonderland";
import type { BoardDefinition } from "./types";

export { ARENA_OVERHANG, arenaBoard, arenaHeight } from "./boards/arena";
export {
  ENDLESS_CLEARING,
  ENDLESS_GROUND,
  ENDLESS_HIGH_GROUNDS,
  ENDLESS_STRIP,
  endlessBoard,
  endlessPage,
} from "./boards/endless";
export { PUZZLE_BOARDS } from "./boards/puzzles";
export { groundSolids } from "./ground";
export type * from "./types";

export const DEMO_BOARD_ID = wonderland.id;

const SKETCHED: ReadonlyMap<string, BoardDefinition> = new Map(
  [wonderland, ...PUZZLE_BOARDS].map((board) => [board.id, board]),
);

export const boardFor = (id: string): BoardDefinition => SKETCHED.get(id) ?? blankBoard(id);
