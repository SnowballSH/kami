import type { BoardDefinition } from "../../types";

const GROUND_TOP = 560;
const DEPTH = 400;
const TINY_GAP = 40;
const LINTEL = { x: 600, y: -1200, width: 400, height: 1200 + GROUND_TOP - TINY_GAP } as const;

/** A crack under a wall a long way high; only shrinking things allowed, or a word about her size. */
export const theKeyhole: BoardDefinition = {
  id: "puzzle-keyhole",
  title: "The Keyhole",
  spawn: { x: 160, y: GROUND_TOP },
  killY: 1400,
  solids: [
    { rect: { x: -800, y: GROUND_TOP, width: 2600, height: DEPTH }, material: "marker" },
    { rect: LINTEL, material: "marker" },
  ],
  zones: [
    {
      id: "the-keyhole",
      title: "The Keyhole",
      intro: "A crack under the wall, about the size of a mouse. She is not the size of a mouse.",
      fromX: Number.NEGATIVE_INFINITY,
      checkpoint: { x: 160, y: GROUND_TOP },
      allowedNatures: ["shrink"],
      hints: [
        "The gap won't grow. Something else will have to change.",
        "In this house, size is a matter of diet. Or of what you write about her.",
        "Draw a little bottle and name it 'shrink', or write 'alice is tiny'. Then under she goes.",
      ],
    },
  ],
  noInkZones: [],
  goal: { x: 1200, y: GROUND_TOP - 100, width: 90, height: 100 },
};
