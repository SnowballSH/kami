import type { LevelDefinition } from "../types";

const FLOOR_TOP = 640;
const TABLE = { x: 60, y: 480, width: 150, height: FLOOR_TOP - 480 } as const;
const TINY_GAP = 40;
const WALL = { x: 840, y: 0, width: 40, height: FLOOR_TOP - TINY_GAP } as const;

export const hallOfDoors: LevelDefinition = {
  id: "hall-of-doors",
  title: "The Hall of Doors",
  intro: "Curiouser and curiouser.",
  ink: 320,
  inkPar: 200,
  namingEnabled: true,
  allowedNatures: ["ink", "grow", "shrink", "heavy", "light", "slippery", "sticky"],
  hints: [
    "Too big for the door, too small for the table. How inconvenient to be only one size.",
    "In this house, size is a matter of diet. But mind the order you dine in.",
    "Draw a cake — eat, grow, take the key. Then draw a bottle — drink, shrink, and through you go.",
  ],
  spawn: { x: 330, y: FLOOR_TOP },
  exit: { x: 910, y: FLOOR_TOP - 100, width: 114, height: 100 },
  killY: 900,
  solids: [
    { rect: { x: 0, y: FLOOR_TOP, width: 1024, height: 128 }, material: "paper" },
    { rect: TABLE, material: "glass" },
    { rect: WALL, material: "paper" },
  ],
  noInkZones: [],
  key: { x: TABLE.x + TABLE.width - 25, y: TABLE.y - 25 },
  door: { x: WALL.x + 5, y: FLOOR_TOP - TINY_GAP, width: WALL.width - 10, height: TINY_GAP },
};
