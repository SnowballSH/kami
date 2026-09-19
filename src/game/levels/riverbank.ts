import type { LevelDefinition } from "../types";

const BANK_TOP = 560;
const BANK_DEPTH = 208;

export const riverbank: LevelDefinition = {
  id: "riverbank",
  title: "The Riverbank",
  intro: "She can't jump. Draw.",
  ink: 600,
  inkPar: 300,
  namingEnabled: false,
  allowedNatures: ["ink"],
  hints: [
    "The Rabbit hopped it. She can't.",
    "Ink is solid. Bank to bank would do.",
    "Draw a line across the ditch, touching both banks. Then walk.",
  ],
  spawn: { x: 120, y: BANK_TOP },
  exit: { x: 850, y: 660, width: 100, height: 108 },
  killY: 900,
  solids: [
    { rect: { x: 0, y: BANK_TOP, width: 380, height: BANK_DEPTH }, material: "paper" },
    { rect: { x: 600, y: BANK_TOP, width: 250, height: BANK_DEPTH }, material: "paper" },
    { rect: { x: 950, y: BANK_TOP, width: 74, height: BANK_DEPTH }, material: "paper" },
  ],
  noInkZones: [],
};
