import type { BoardDefinition } from "../../types";

const GROUND_TOP = 560;
const DEPTH = 400;
const BOX_TOP = 260;
const BOX_LEFT = -40;
const BOX_RIGHT = 400;
const WALL_WIDTH = 40;

/** She starts sealed in a box with no way out; only portals allowed, and a portal needs a twin. */
export const theTwinDoors: BoardDefinition = {
  id: "puzzle-twin-doors",
  title: "The Twin Doors",
  spawn: { x: 180, y: GROUND_TOP },
  killY: 1400,
  solids: [
    { rect: { x: -800, y: GROUND_TOP, width: 2600, height: DEPTH }, material: "marker" },
    {
      rect: { x: BOX_LEFT, y: BOX_TOP, width: WALL_WIDTH, height: GROUND_TOP - BOX_TOP },
      material: "marker",
    },
    {
      rect: { x: BOX_RIGHT, y: BOX_TOP, width: WALL_WIDTH, height: GROUND_TOP - BOX_TOP },
      material: "marker",
    },
    {
      rect: { x: BOX_LEFT, y: BOX_TOP - 40, width: BOX_RIGHT + WALL_WIDTH - BOX_LEFT, height: 40 },
      material: "marker",
    },
  ],
  zones: [
    {
      id: "the-twin-doors",
      title: "The Twin Doors",
      intro: "No door in, no door out. So draw one. Doors come in pairs.",
      fromX: Number.NEGATIVE_INFINITY,
      checkpoint: { x: 180, y: GROUND_TOP },
      allowedNatures: ["portal"],
      hints: [
        "Four walls and a lid. Walking won't do it.",
        "A door that isn't in a wall. It needs somewhere to let out.",
        "Draw a ring beside her and name it 'portal'. Draw another outside the box. Step in.",
      ],
    },
  ],
  noInkZones: [],
  goal: { x: 1000, y: GROUND_TOP - 100, width: 90, height: 100 },
};
