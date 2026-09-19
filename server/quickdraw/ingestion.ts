import { type FetchLike, fetchCategoryDrawings, toStrokes } from "./dataset";
import { computeFeature } from "./feature";
import type { QuickdrawSample, QuickdrawSampleRepository } from "./sampleRepository";

export const DEFAULT_SAMPLES_PER_CATEGORY = 300;
const FETCH_CONCURRENCY = 6;

export interface IngestReport {
  readonly category: string;
  readonly samples: number;
}

const fetchCategorySamples = async (
  category: string,
  limit: number,
  fetchFn?: FetchLike,
): Promise<readonly QuickdrawSample[]> => {
  const drawings = await fetchCategoryDrawings(category, limit, fetchFn);
  return drawings.map(({ keyId, drawing }) => ({
    category,
    keyId,
    drawing,
    feature: computeFeature(toStrokes(drawing)),
  }));
};

export const ingestQuickdraw = async (
  repository: QuickdrawSampleRepository,
  categories: readonly string[],
  samplesPerCategory: number,
  fetchFn?: FetchLike,
): Promise<readonly IngestReport[]> => {
  await repository.ensureIndexes();
  const reports: IngestReport[] = [];
  const pending = [...categories];
  const worker = async (): Promise<void> => {
    for (let category = pending.shift(); category !== undefined; category = pending.shift()) {
      const samples = await fetchCategorySamples(category, samplesPerCategory, fetchFn);
      await repository.upsertCategory(category, samples);
      reports.push({ category, samples: samples.length });
      console.log(`${category}: ${samples.length} drawings`);
    }
  };
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
  await repository.retainCategories(categories);
  return reports;
};
