import type { BoardDefinition } from "../types";

const FLOOR_HEIGHT = 36;
const WALL_WIDTH = 24;
export const ARENA_OVERHANG = 200;

export const arenaHeight = (board: Pick<BoardDefinition, "killY">): number =>
  board.killY - ARENA_OVERHANG;

export const arenaBoard = (
  id: string,
  size: { readonly width: number; readonly height: number },
): BoardDefinition => ({
  id,
  title: id,
  page: "arena",
  spawn: { x: 0, y: 0 },
  killY: size.height + ARENA_OVERHANG,
  solids: [
    {
      rect: { x: -size.width / 2, y: 0, width: size.width, height: FLOOR_HEIGHT },
      material: "marker",
    },
    {
      rect: {
        x: -size.width / 2,
        y: -size.height - ARENA_OVERHANG,
        width: WALL_WIDTH,
        height: size.height + ARENA_OVERHANG,
      },
      material: "marker",
    },
    {
      rect: {
        x: size.width / 2 - WALL_WIDTH,
        y: -size.height - ARENA_OVERHANG,
        width: WALL_WIDTH,
        height: size.height + ARENA_OVERHANG,
      },
      material: "marker",
    },
  ],
  zones: [],
  noInkZones: [],
});
