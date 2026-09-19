import { blankBoard } from "./boards/blank";
import { wonderland } from "./boards/wonderland";
import type { BoardDefinition } from "./types";

export type * from "./types";

export const DEMO_BOARD_ID = wonderland.id;

const SKETCHED: ReadonlyMap<string, BoardDefinition> = new Map([[wonderland.id, wonderland]]);

/** Pre-sketched boards by id; any other id is a blank board of the player's own. */
export const boardFor = (id: string): BoardDefinition => SKETCHED.get(id) ?? blankBoard(id);
