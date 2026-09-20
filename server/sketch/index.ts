import { ExemplarLibrary } from "./exemplarLibrary";
import { QuickdrawLibrary } from "./quickdrawLibrary";
import { FirstAnswering, type SketchStore, StoredLibrary } from "./storedLibrary";
import type { SketchLibrary } from "./types";

export type { Sketch, SketchLibrary } from "./types";

export interface SketchLibraryOptions {
  /** The k-NN's ingested samples, tried before Quick, Draw! itself when there is no exemplar set. */
  readonly stored?: SketchStore;
  readonly log?: (line: string) => void;
}

/**
 * The Eye's exemplar set when one is at `directory` (every category, the cleanest drawings);
 * otherwise whatever Quick, Draw! samples were ingested, then Quick, Draw! itself.
 */
export const createSketchLibrary = async (
  directory: string | null,
  { stored, log = () => {} }: SketchLibraryOptions = {},
): Promise<SketchLibrary> => {
  const fallback = () =>
    stored === undefined
      ? new QuickdrawLibrary()
      : new FirstAnswering([new StoredLibrary(stored), new QuickdrawLibrary()]);
  if (directory === null) return fallback();
  try {
    return await ExemplarLibrary.load(directory);
  } catch (error) {
    log(`summoning: could not read the exemplar set at ${directory}: ${String(error)}`);
    return fallback();
  }
};
