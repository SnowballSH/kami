import { toStrokes } from "./dataset";
import { prefixFeaturesOf } from "./prefixFeatures";
import type { QuickdrawSample, QuickdrawSampleRepository, StoredSketch } from "./sampleRepository";

export const sampleOf = (sketch: StoredSketch): QuickdrawSample => ({
  ...sketch,
  features: prefixFeaturesOf(toStrokes(sketch.drawing)),
});

/** Stores the sketches with freshly computed prefix features, one category at a time. */
export const indexSketches = async (
  repository: QuickdrawSampleRepository,
  sketches: readonly StoredSketch[],
): Promise<number> => {
  await repository.ensureIndexes();
  for (const [category, group] of Map.groupBy(sketches, (sketch) => sketch.category)) {
    await repository.upsertCategory(category, group.map(sampleOf));
  }
  return sketches.length;
};

/** Recomputes every feature from the drawings already stored; needs no network. */
export const reindexStoredSketches = async (
  repository: QuickdrawSampleRepository,
): Promise<number> => indexSketches(repository, await repository.loadDrawings());
