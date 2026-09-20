import type { BoardDefinition } from "../../types";
import { theKeyhole } from "./theKeyhole";
import { theMoonLedge } from "./theMoonLedge";
import { thePit } from "./thePit";
import { theShaft } from "./theShaft";
import { theTwinDoors } from "./theTwinDoors";
import { theWall } from "./theWall";

/** The puzzle rooms, in the order they are played. */
export const PUZZLE_BOARDS: readonly BoardDefinition[] = [
  theWall,
  theKeyhole,
  theMoonLedge,
  theTwinDoors,
  theShaft,
  thePit,
];
