import type { BoardDefinition } from "../board/types";

const FOOTING = { x: -200, y: 0, width: 400, height: 40 } as const;

/** What the simulation holds before the game loads a real board. */
export const EMPTY_BOARD: BoardDefinition = {
  id: "",
  title: "",
  spawn: { x: 0, y: FOOTING.y },
  killY: Number.POSITIVE_INFINITY,
  solids: [{ rect: FOOTING, material: "marker" }],
  zones: [],
  noInkZones: [],
};
