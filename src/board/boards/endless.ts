import type { BoardDefinition } from "../types";

export const ENDLESS_GROUND = { x: -400, y: 0, width: 800, height: 36 } as const;

/** A page with no edges: a strip of ground under Alice, then nothing until someone draws. */
export const endlessBoard = (id: string): BoardDefinition => ({
  id,
  title: id,
  page: "endless",
  spawn: { x: 0, y: ENDLESS_GROUND.y },
  killY: Number.POSITIVE_INFINITY,
  solids: [{ rect: ENDLESS_GROUND, material: "marker" }],
  zones: [],
  noInkZones: [],
});
