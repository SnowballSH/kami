import { WORLD } from "../core/world";
import type { LevelDefinition } from "../game/types";

/** What the simulation holds before the game loads a real room. */
export const BLANK_LEVEL: LevelDefinition = {
  id: "blank",
  title: "",
  intro: "",
  ink: 0,
  inkPar: 0,
  namingEnabled: false,
  allowedNatures: [],
  hints: ["", "", ""],
  spawn: { x: WORLD.width / 2, y: WORLD.height },
  exit: { x: 0, y: 0, width: 0, height: 0 },
  killY: Number.POSITIVE_INFINITY,
  solids: [{ rect: { x: 0, y: WORLD.height, width: WORLD.width, height: 1 }, material: "paper" }],
  noInkZones: [],
};
