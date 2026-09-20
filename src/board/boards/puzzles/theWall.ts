import type { BoardDefinition } from "../../types";

const GROUND_TOP = 560;
const DEPTH = 400;
const WALL = { x: 720, y: GROUND_TOP - 200, width: 80, height: 200 } as const;
const APPROACH = 200;
const FOOT_ROOM = 60;

/** A wall too tall to climb, and only springing things allowed; nothing may be drawn near it except low, at its foot. */
export const theWall: BoardDefinition = {
  id: "puzzle-wall",
  title: "The Wall",
  spawn: { x: 160, y: GROUND_TOP },
  killY: 1400,
  solids: [
    { rect: { x: -800, y: GROUND_TOP, width: 2600, height: DEPTH }, material: "marker" },
    { rect: WALL, material: "marker" },
  ],
  zones: [
    {
      id: "the-wall",
      title: "The Wall",
      intro: "Too tall to climb. She could fall up, if something threw her.",
      fromX: Number.NEGATIVE_INFINITY,
      checkpoint: { x: 160, y: GROUND_TOP },
      allowedNatures: ["bouncy"],
      hints: [
        "No rungs here. Only things that spring.",
        "A mushroom, a spring, a trampoline. Something that throws her.",
        "Draw a blob at the foot of the wall, write 'bouncy' beside it, and let her step on.",
      ],
    },
  ],
  noInkZones: [
    {
      x: WALL.x - APPROACH,
      y: WALL.y - 800,
      width: APPROACH,
      height: 800 + WALL.height - FOOT_ROOM,
    },
    { x: WALL.x, y: WALL.y - 800, width: WALL.width, height: 800 },
  ],
  goal: { x: 1120, y: GROUND_TOP - 100, width: 90, height: 100 },
};
