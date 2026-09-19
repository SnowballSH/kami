import { ScriptedCat } from "./cat";
import type { Cat } from "./types";

export * from "./types";

export function createCat(): Cat {
  return new ScriptedCat();
}
