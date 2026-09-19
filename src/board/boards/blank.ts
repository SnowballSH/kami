import type { BoardDefinition } from "../types";

const PATCH = { x: -320, y: 0, width: 640, height: 36 } as const;

/** A new game: a patch of ground under Alice, and everything else is yours to sketch. */
export const blankBoard = (id: string): BoardDefinition => ({
  id,
  title: id,
  spawn: { x: 0, y: PATCH.y },
  killY: 4000,
  solids: [{ rect: PATCH, material: "marker" }],
  zones: [],
  noInkZones: [],
});
