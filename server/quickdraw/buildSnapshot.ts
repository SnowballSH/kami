import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { QUICKDRAW_CATEGORIES } from "./categories";
import type { FetchLike } from "./dataset";
import { DEFAULT_SAMPLES_PER_CATEGORY, fetchQuickdrawSketches } from "./ingestion";
import type { StoredSketch } from "./sampleRepository";
import { writeSnapshot } from "./snapshotFile";

const USAGE =
  "usage: bun server/quickdraw/buildSnapshot.ts <file.ndjson.gz> [samples per category]";

export interface BuildSnapshotOptions {
  readonly categories?: readonly string[];
  readonly samplesPerCategory?: number;
  readonly fetchFn?: FetchLike;
  readonly log?: (line: string) => void;
}

const samplesPerCategoryFrom = (value: string | undefined): number => {
  const requested = Number(value);
  return Number.isInteger(requested) && requested > 0 ? requested : DEFAULT_SAMPLES_PER_CATEGORY;
};

const byCategoryThenKey = (a: StoredSketch, b: StoredSketch): number =>
  a.category.localeCompare(b.category) || a.keyId.localeCompare(b.keyId);

/**
 * Builds the snapshot `snapshot.ts import` and a fresh container read straight from the dataset,
 * with no MongoDB in the way: what an image build has is the network, not a database.
 */
export const buildSnapshot = async (
  path: string,
  {
    categories = QUICKDRAW_CATEGORIES,
    samplesPerCategory = DEFAULT_SAMPLES_PER_CATEGORY,
    fetchFn,
    log = () => {},
  }: BuildSnapshotOptions = {},
): Promise<number> => {
  const sketches: StoredSketch[] = [];
  await fetchQuickdrawSketches(
    categories,
    samplesPerCategory,
    async (fetched) => {
      sketches.push(...fetched.sketches);
      log(`${fetched.category}: ${fetched.sketches.length} drawings`);
    },
    fetchFn,
  );
  await mkdir(dirname(path), { recursive: true });
  return writeSnapshot(sketches.sort(byCategoryThenKey), path);
};

if (import.meta.main) {
  const [path, samples] = process.argv.slice(2);
  if (path === undefined) {
    console.error(USAGE);
    process.exit(2);
  }
  const count = await buildSnapshot(path, {
    samplesPerCategory: samplesPerCategoryFrom(samples),
    log: console.log,
  });
  console.log(`Wrote ${count} Quick, Draw! sketches to ${path}`);
}
