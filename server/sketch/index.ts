import { ExemplarLibrary } from "./exemplarLibrary";
import { QuickdrawLibrary } from "./quickdrawLibrary";
import type { SketchLibrary } from "./types";

export type { Sketch, SketchLibrary } from "./types";

export interface SketchLibraryOptions {
  readonly log?: (line: string) => void;
}

/** The Eye's exemplar set when one is at `directory`, Quick, Draw! itself otherwise. */
export const createSketchLibrary = async (
  directory: string | null,
  { log = () => {} }: SketchLibraryOptions = {},
): Promise<SketchLibrary> => {
  if (directory === null) return new QuickdrawLibrary();
  try {
    return await ExemplarLibrary.load(directory);
  } catch (error) {
    log(`summoning: could not read the exemplar set at ${directory}: ${String(error)}`);
    return new QuickdrawLibrary();
  }
};
