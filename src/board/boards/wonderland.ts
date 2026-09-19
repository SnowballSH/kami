import type { BoardDefinition } from "../types";

const GROUND_TOP = 560;
const PLATEAU_TOP = 340;
const DEPTH = 400;
const TABLE = { x: 1850, y: PLATEAU_TOP - 160, width: 150, height: 20 } as const;
const TINY_GAP = 40;
const WALL = { x: 2500, y: -2000, width: 40, height: 2000 + PLATEAU_TOP - TINY_GAP } as const;

/** The Alice demo: three puzzles sketched left to right along one board. */
export const wonderland: BoardDefinition = {
  id: "wonderland",
  title: "Wonderland",
  spawn: { x: 120, y: GROUND_TOP },
  killY: 1400,
  solids: [
    { rect: { x: -2000, y: GROUND_TOP, width: 2380, height: DEPTH }, material: "marker" },
    { rect: { x: 600, y: GROUND_TOP, width: 900, height: DEPTH }, material: "marker" },
    {
      rect: { x: 1500, y: PLATEAU_TOP, width: 1900, height: DEPTH + GROUND_TOP - PLATEAU_TOP },
      material: "marker",
    },
    { rect: TABLE, material: "glass" },
    { rect: WALL, material: "marker" },
  ],
  zones: [
    {
      id: "riverbank",
      title: "The Riverbank",
      intro: "She can hop, not fly. You can draw.",
      fromX: Number.NEGATIVE_INFINITY,
      checkpoint: { x: 120, y: GROUND_TOP },
      allowedNatures: "all",
      hints: [
        "The Rabbit hopped it. She can't.",
        "Ink is solid. Bank to bank would do.",
        "Draw a line across the ditch, touching both banks. Then walk.",
      ],
    },
    {
      id: "shelves",
      title: "The Shelves",
      intro: "The way on is up. Draw it, then tell me what it is.",
      fromX: 700,
      checkpoint: { x: 760, y: GROUND_TOP },
      allowedNatures: "all",
      hints: [
        "Up is a long way when all you can do is walk.",
        "Things that spring, things with rungs, things that rise. Say what it is.",
        "Draw a blob by the ledge, write 'bouncy mushroom' beside it, and walk onto it.",
      ],
    },
    {
      id: "hall-of-doors",
      title: "The Hall of Doors",
      intro: "Curiouser and curiouser.",
      fromX: 1700,
      checkpoint: { x: 1760, y: PLATEAU_TOP },
      allowedNatures: "all",
      hints: [
        "Too big for the door, too small for the table. How inconvenient to be only one size.",
        "In this house, size is a matter of diet. But mind the order you dine in.",
        "Draw a cake — eat, grow, take the key. Then a bottle — drink, shrink, and through you go.",
      ],
    },
  ],
  noInkZones: [],
  key: { x: TABLE.x + TABLE.width - 15, y: TABLE.y - 25 },
  door: { x: WALL.x + 5, y: PLATEAU_TOP - TINY_GAP, width: WALL.width - 10, height: TINY_GAP },
  goal: { x: 2700, y: PLATEAU_TOP - 100, width: 90, height: 100 },
};
