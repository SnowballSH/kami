import { blankBoard } from "./boards/blank";
import { endlessBoard } from "./boards/endless";
import { PUZZLE_BOARDS } from "./boards/puzzles";
import { wonderland } from "./boards/wonderland";
import type { BoardDefinition, PageKind } from "./types";

export { PUZZLE_BOARDS } from "./boards/puzzles";
export type * from "./types";

export const DEMO_BOARD_ID = wonderland.id;

const SKETCHED: ReadonlyMap<string, BoardDefinition> = new Map(
  [wonderland, ...PUZZLE_BOARDS].map((board) => [board.id, board]),
);

export const boardFor = (id: string): BoardDefinition => SKETCHED.get(id) ?? blankBoard(id);

/** The board as a kind of page asks for it: a room as sketched, or the same id as an endless page. */
export const pageFor = (kind: PageKind, id: string): BoardDefinition =>
  kind === "endless" ? endlessBoard(id) : boardFor(id);

export const isEndless = (board: BoardDefinition): boolean => board.page === "endless";

export {
  ENDLESS_CLEARING,
  ENDLESS_GROUND,
  ENDLESS_HIGH_GROUNDS,
  ENDLESS_STRIP,
  endlessBoard,
  endlessPage,
} from "./boards/endless";
export { arenaBoard } from "./boards/arena";
