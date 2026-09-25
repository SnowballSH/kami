import { type FetchLike, fetchCategoryDrawings } from "./dataset";
import { sampleOf } from "./indexing";
import type { QuickdrawSampleRepository, StoredSketch } from "./sampleRepository";

export const DEFAULT_SAMPLES_PER_CATEGORY = 300;
const FETCH_CONCURRENCY = 6;

export interface IngestReport {
  readonly category: string;
  readonly samples: number;
}

export interface CategorySketches {
  readonly category: string;
  readonly sketches: readonly StoredSketch[];
}

const fetchCategorySketches = async (
  category: string,
  limit: number,
  fetchFn?: FetchLike,
): Promise<CategorySketches> => {
  const drawings = await fetchCategoryDrawings(category, limit, fetchFn);
  return {
    category,
    sketches: drawings.map(({ keyId, drawing }) => ({ category, keyId, drawing })),
  };
};

/** Downloads every category a few at a time, handing each one over as soon as it has arrived. */
export const fetchQuickdrawSketches = async (
  categories: readonly string[],
  samplesPerCategory: number,
  onCategory: (fetched: CategorySketches) => Promise<void>,
  fetchFn?: FetchLike,
): Promise<void> => {
  const pending = [...categories];
  const worker = async (): Promise<void> => {
    for (let category = pending.shift(); category !== undefined; category = pending.shift()) {
      await onCategory(await fetchCategorySketches(category, samplesPerCategory, fetchFn));
    }
  };
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
};

export const ingestQuickdraw = async (
  repository: QuickdrawSampleRepository,
  categories: readonly string[],
  samplesPerCategory: number,
  fetchFn?: FetchLike,
): Promise<readonly IngestReport[]> => {
  await repository.ensureIndexes();
  const reports: IngestReport[] = [];
  await fetchQuickdrawSketches(
    categories,
    samplesPerCategory,
    async ({ category, sketches }) => {
      await repository.upsertCategory(category, sketches.map(sampleOf));
      reports.push({ category, samples: sketches.length });
      console.log(`${category}: ${sketches.length} drawings`);
    },
    fetchFn,
  );
  await repository.retainCategories(categories);
  return reports;
};
