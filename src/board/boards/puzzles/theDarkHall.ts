import type { BoardDefinition } from "../../types";

const GROUND_TOP = 560;
const DEPTH = 400;
const CEILING = { x: -200, y: 340, width: 1700, height: 40 } as const;

/** A hall in pitch dark, and only things that glow allowed; she will not walk where she cannot see. */
export const theDarkHall: BoardDefinition = {
  id: "puzzle-dark-hall",
  title: "The Dark Hall",
  spawn: { x: 140, y: GROUND_TOP },
  killY: 1400,
  solids: [
    { rect: { x: -800, y: GROUND_TOP, width: 2600, height: DEPTH }, material: "marker" },
    { rect: CEILING, material: "marker" },
  ],
  zones: [
    {
      id: "the-dark-hall",
      title: "The Dark Hall",
      intro: "She won't take a step she can't see. Light doesn't carry far in here.",
      fromX: Number.NEGATIVE_INFINITY,
      checkpoint: { x: 140, y: GROUND_TOP },
      allowedNatures: ["lantern"],
      hints: [
        "Nothing wrong with her legs. It's her eyes.",
        "Something that glows. One won't reach the end of the hall.",
        "Hang a lantern from the ceiling beside her, and name it. Then another, farther on.",
      ],
    },
  ],
  noInkZones: [],
  goal: { x: 1000, y: GROUND_TOP - 100, width: 90, height: 100 },
};
