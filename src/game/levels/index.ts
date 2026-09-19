import type { LevelDefinition } from "../types";
import { hallOfDoors } from "./hallOfDoors";
import { riverbank } from "./riverbank";
import { shelves } from "./shelves";

export const LEVELS: readonly LevelDefinition[] = [riverbank, shelves, hallOfDoors];
