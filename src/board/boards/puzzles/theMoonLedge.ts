import type { BoardDefinition } from "../../types";

const GROUND_TOP = 560;
const LEDGE_TOP = GROUND_TOP - 200;
const DEPTH = 400;
const LEDGE_X = 700;

/** A ledge twice her best hop, nothing may be named, and the page will only hear about gravity. */
export const theMoonLedge: BoardDefinition = {
  id: "puzzle-moon-ledge",
  title: "The Moon Ledge",
  spawn: { x: 160, y: GROUND_TOP },
  killY: 1400,
  solids: [
    { rect: { x: -800, y: GROUND_TOP, width: 800 + LEDGE_X, height: DEPTH }, material: "marker" },
    {
      rect: { x: LEDGE_X, y: LEDGE_TOP, width: 1800, height: DEPTH + GROUND_TOP - LEDGE_TOP },
      material: "marker",
    },
  ],
  zones: [
    {
      id: "the-moon-ledge",
      title: "The Moon Ledge",
      intro: "Her legs are fine. It's the ground that pulls too hard.",
      fromX: Number.NEGATIVE_INFINITY,
      checkpoint: { x: 160, y: GROUND_TOP },
      allowedNatures: [],
      hints: [
        "Nothing you draw will be anything but ink here. Write, instead.",
        "Somewhere she would weigh less. The page knows the Moon.",
        "Write 'we are on the moon', and let her hop.",
      ],
    },
  ],
  noInkZones: [
    { x: LEDGE_X - 160, y: LEDGE_TOP - 800, width: 160, height: 800 + GROUND_TOP - LEDGE_TOP },
  ],
  goal: { x: 1200, y: LEDGE_TOP - 100, width: 90, height: 100 },
};
