import { QUICKDRAW_CATEGORIES } from "./categories";
import { type FetchLike, fetchCategoryDrawings } from "./dataset";
import { type StoredSketch, writeSnapshot } from "./snapshotFile";

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

export interface IngestOptions {
  readonly categories?: readonly string[];
  readonly samplesPerCategory?: number;
  readonly fetchFn?: FetchLike;
  readonly log?: (line: string) => void;
}

/** Downloads the curated categories and writes them as the snapshot at `path`, replacing what was there. */
export const ingestQuickdraw = async (
  path: string,
  {
    categories = QUICKDRAW_CATEGORIES,
    samplesPerCategory = DEFAULT_SAMPLES_PER_CATEGORY,
    fetchFn,
    log = () => {},
  }: IngestOptions = {},
): Promise<readonly IngestReport[]> => {
  const sketches: StoredSketch[] = [];
  const reports: IngestReport[] = [];
  await fetchQuickdrawSketches(
    categories,
    samplesPerCategory,
    async (fetched) => {
      sketches.push(...fetched.sketches);
      reports.push({ category: fetched.category, samples: fetched.sketches.length });
      log(`${fetched.category}: ${fetched.sketches.length} drawings`);
    },
    fetchFn,
  );
  await writeSnapshot(sketches, path);
  return reports;
};
