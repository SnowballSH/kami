import type { BoardDefinition } from "../../types";

const GROUND_TOP = 560;
const DEPTH = 400;
const SHAFT_TOP = -900;
const LEFT_WALL = { x: -140, y: SHAFT_TOP, width: 40, height: GROUND_TOP - SHAFT_TOP } as const;
const RIGHT_WALL = { x: 500, y: SHAFT_TOP, width: 40, height: GROUND_TOP - SHAFT_TOP } as const;

/** The bottom of a shaft with the way out far above; nothing may be named, and the page will only hear about wings. */
export const theShaft: BoardDefinition = {
  id: "puzzle-shaft",
  title: "The Shaft",
  spawn: { x: 180, y: GROUND_TOP },
  killY: 1400,
  solids: [
    { rect: { x: -800, y: GROUND_TOP, width: 2600, height: DEPTH }, material: "marker" },
    { rect: LEFT_WALL, material: "marker" },
    { rect: RIGHT_WALL, material: "marker" },
  ],
  zones: [
    {
      id: "the-shaft",
      title: "The Shaft",
      intro: "The Rabbit fell down here. He was in no hurry to fall back up.",
      fromX: Number.NEGATIVE_INFINITY,
      checkpoint: { x: 180, y: GROUND_TOP },
      allowedNatures: [],
      hints: [
        "Ink won't stick to these walls. Something about her would have to change.",
        "What goes up a shaft with no stairs? Birds do.",
        "Write 'alice can fly'. Then let her.",
      ],
    },
  ],
  noInkZones: [
    {
      x: LEFT_WALL.x + LEFT_WALL.width,
      y: SHAFT_TOP,
      width: RIGHT_WALL.x - LEFT_WALL.x - LEFT_WALL.width,
      height: GROUND_TOP - 160 - SHAFT_TOP,
    },
  ],
  goal: { x: 200, y: -700, width: 90, height: 100 },
};
