/** When a reading is sure enough for the game to name the drawing without asking the player. */
import type { CertaintyFloor, CertaintyFloors, RankedCategory, RankOptions } from "./types";

export const floorFor = (
  floors: CertaintyFloors,
  { partial = false }: RankOptions = {},
): CertaintyFloor => (partial ? floors.partial : floors.finished);

export const isCertain = (
  leader: RankedCategory | undefined,
  certainAbove: CertaintyFloor,
): boolean => leader !== undefined && certainAbove !== null && leader.confidence >= certainAbove;
