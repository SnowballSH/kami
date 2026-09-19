import type { LevelDefinition } from "../types";

const FLOOR_TOP = 640;
const LEDGE_TOP = 420;

export const shelves: LevelDefinition = {
  id: "shelves",
  title: "The Shelves",
  intro: "Down, down, down. The way on is up.",
  ink: 270,
  inkPar: 160,
  namingEnabled: true,
  allowedNatures: ["ink", "bouncy", "climbable", "floaty", "heavy", "light", "slippery", "sticky"],
  hints: [
    "Up is a long way when all you can do is walk.",
    "Things that spring, things with rungs, things that rise. Say what it is.",
    "Draw a blob by the bookcase, call it a bouncy mushroom, and walk onto it.",
  ],
  spawn: { x: 120, y: FLOOR_TOP },
  exit: { x: 930, y: LEDGE_TOP - 100, width: 80, height: 100 },
  killY: 900,
  solids: [
    { rect: { x: 0, y: FLOOR_TOP, width: 1024, height: 128 }, material: "paper" },
    {
      rect: { x: 700, y: LEDGE_TOP, width: 324, height: FLOOR_TOP - LEDGE_TOP },
      material: "paper",
    },
  ],
  noInkZones: [],
};
