import { blankBoard } from "./boards/blank";
import { endlessBoard } from "./boards/endless";
import { wonderland } from "./boards/wonderland";
import type { BoardDefinition, PageKind } from "./types";

export type * from "./types";

export const DEMO_BOARD_ID = wonderland.id;

const SKETCHED: ReadonlyMap<string, BoardDefinition> = new Map([[wonderland.id, wonderland]]);

/** Pre-sketched boards by id; any other id is a blank board of the player's own. */
export const boardFor = (id: string): BoardDefinition => SKETCHED.get(id) ?? blankBoard(id);

/** The board as a kind of page asks for it: a room as sketched, or the same id as an endless page. */
export const pageFor = (kind: PageKind, id: string): BoardDefinition =>
  kind === "endless" ? endlessBoard(id) : boardFor(id);

export const isEndless = (board: BoardDefinition): boolean => board.page === "endless";

export { ENDLESS_GROUND, endlessBoard } from "./boards/endless";
