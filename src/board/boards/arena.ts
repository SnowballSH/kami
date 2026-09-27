import { marker } from "../solids";
import type { BoardDefinition, SolidDef } from "../types";

const FLOOR_HEIGHT = 36;
const WALL_WIDTH = 24;
export const ARENA_OVERHANG = 200;

export const arenaHeight = (board: Pick<BoardDefinition, "killY">): number =>
  board.killY - ARENA_OVERHANG;

export const arenaBoard = (
  id: string,
  size: { readonly width: number; readonly height: number },
): BoardDefinition => {
  const wall = (x: number): SolidDef =>
    marker({
      x,
      y: -size.height - ARENA_OVERHANG,
      width: WALL_WIDTH,
      height: size.height + ARENA_OVERHANG,
    });
  return {
    id,
    title: id,
    page: "arena",
    spawn: { x: 0, y: 0 },
    killY: size.height + ARENA_OVERHANG,
    solids: [
      marker({ x: -size.width / 2, y: 0, width: size.width, height: FLOOR_HEIGHT }),
      wall(-size.width / 2),
      wall(size.width / 2 - WALL_WIDTH),
    ],
    zones: [],
    noInkZones: [],
  };
};
