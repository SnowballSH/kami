import type { Recognizer } from "../recognition/types";
import { ScriptedCat } from "./cat";
import type { Cat } from "./types";

export * from "./types";

export function createCat(_recognizer?: Recognizer): Cat {
  return new ScriptedCat();
}
