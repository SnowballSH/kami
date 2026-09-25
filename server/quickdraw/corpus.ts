import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { buildCorpusIndex, type CorpusIndex, corpusIndexKey } from "./corpusIndex";
import { buildFeatureMatrix } from "./featureMatrix";
import { readIndexFile, writeIndexFile } from "./indexFile";
import { parseSnapshot, type StoredSketch } from "./snapshotFile";

const SNAPSHOT_SUFFIX = /\.ndjson(\.gz)?$/;
const INDEX_SUFFIX = ".features.bin";

/**
 * The Quick, Draw! drawings the server knows: the k-NN's feature matrix and a few of the most
 * typical drawings of each category to summon by name. Read-only; built from the snapshot file.
 */
export class QuickdrawCorpus {
  static readonly empty = new QuickdrawCorpus({
    matrix: buildFeatureMatrix([]),
    summons: new Map(),
  });

  readonly matrix: CorpusIndex["matrix"];
  readonly #summons: CorpusIndex["summons"];
  readonly #random: () => number;

  constructor({ matrix, summons }: CorpusIndex, random: () => number = Math.random) {
    this.matrix = matrix;
    this.#summons = summons;
    this.#random = random;
  }

  /** How many whole drawings the k-NN compares with. */
  get size(): number {
    return this.matrix.completeRows;
  }

  /** One of the category's summonable drawings, a random one each time; null for a category it lacks. */
  async anyOf(category: string): Promise<StoredSketch | null> {
    const shelf = this.#summons.get(category) ?? [];
    return shelf[Math.floor(this.#random() * shelf.length)] ?? null;
  }
}

export interface LoadedCorpus {
  readonly corpus: QuickdrawCorpus;
  readonly description: string;
}

/** Where a snapshot's index is looked for, and written: beside it first, then in the data directory. */
export const indexPathsFor = (snapshot: string, dataDirectory: string): readonly string[] => {
  const name = `${basename(snapshot).replace(SNAPSHOT_SUFFIX, "")}${INDEX_SUFFIX}`;
  return [...new Set([join(dirname(snapshot), name), join(dataDirectory, name)])];
};

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const firstCached = async (
  paths: readonly string[],
  key: string,
): Promise<{ readonly path: string; readonly index: CorpusIndex } | null> => {
  for (const path of paths) {
    const index = await readIndexFile(path, key);
    if (index !== null) return { path, index };
  }
  return null;
};

const saveSomewhere = async (
  paths: readonly string[],
  key: string,
  index: CorpusIndex,
): Promise<string> => {
  const failures: string[] = [];
  for (const path of paths) {
    try {
      await writeIndexFile(path, key, index);
      return `cached in ${path}`;
    } catch (error) {
      failures.push(`${path}: ${reasonOf(error)}`);
    }
  }
  return `not cached (${failures.join("; ")})`;
};

const loadFrom = async (snapshot: string, indexPaths: readonly string[]): Promise<LoadedCorpus> => {
  const bytes = await readFile(snapshot);
  const key = corpusIndexKey(bytes);
  const cached = await firstCached(indexPaths, key);
  if (cached !== null) {
    const corpus = new QuickdrawCorpus(cached.index);
    return {
      corpus,
      description: `quickdraw: ${corpus.size} sketches from ${snapshot}, features read from ${cached.path}`,
    };
  }
  const startedAt = performance.now();
  const index = buildCorpusIndex(parseSnapshot(bytes));
  const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
  const saved = await saveSomewhere(indexPaths, key, index);
  const corpus = new QuickdrawCorpus(index);
  return {
    corpus,
    description: `quickdraw: ${corpus.size} sketches from ${snapshot}, features computed in ${seconds} s and ${saved}`,
  };
};

/**
 * The corpus in `snapshot`, its features read from the first index built for exactly this snapshot
 * and this feature code, or computed and cached for next time. A missing or broken snapshot is an
 * empty corpus, never a failed start: the recogniser then has nothing to say.
 */
export const loadQuickdrawCorpus = async (
  snapshot: string,
  indexPaths: readonly string[],
): Promise<LoadedCorpus> => {
  try {
    return await loadFrom(snapshot, indexPaths);
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return {
      corpus: QuickdrawCorpus.empty,
      description: missing
        ? `quickdraw: no corpus at ${snapshot} (run \`bun run quickdraw:ingest\`)`
        : `quickdraw: could not read ${snapshot}: ${reasonOf(error)}`,
    };
  }
};
