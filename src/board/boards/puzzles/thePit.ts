import type { BoardDefinition } from "../../types";

const GROUND_TOP = 560;
const DEPTH = 400;
const PIT_DEPTH = 600;
const LEFT_WALL = { x: -140, y: GROUND_TOP - PIT_DEPTH, width: 40, height: PIT_DEPTH } as const;
const RIGHT_WALL = { x: 400, y: GROUND_TOP - PIT_DEPTH, width: 40, height: PIT_DEPTH } as const;

/** A pit deeper than any spring can throw her under this much gravity: it takes a drawing and a law together. */
export const thePit: BoardDefinition = {
  id: "puzzle-pit",
  title: "The Pit",
  spawn: { x: 160, y: GROUND_TOP },
  killY: 1400,
  solids: [
    { rect: { x: -800, y: GROUND_TOP, width: 2600, height: DEPTH }, material: "marker" },
    { rect: LEFT_WALL, material: "marker" },
    { rect: RIGHT_WALL, material: "marker" },
  ],
  zones: [
    {
      id: "the-pit",
      title: "The Pit",
      intro: "Deeper than any spring can throw her. Unless she weighed less.",
      fromX: Number.NEGATIVE_INFINITY,
      checkpoint: { x: 160, y: GROUND_TOP },
      allowedNatures: ["bouncy"],
      hints: [
        "One idea won't do it. It wants two.",
        "Something that throws her, and a page that pulls less. Draw one, write the other.",
        "Draw a blob and name it 'bouncy'. Write 'we are on the moon'. Then let her step on.",
      ],
    },
  ],
  noInkZones: [],
  goal: { x: 900, y: GROUND_TOP - 100, width: 90, height: 100 },
};
