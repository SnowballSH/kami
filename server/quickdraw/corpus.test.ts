// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { plainMatrix } from "../testing/matrices";
import { circleSketch, lineSketch, toSimplified } from "../testing/sketches";
import { indexPathsFor, loadQuickdrawCorpus, QuickdrawCorpus } from "./corpus";
import { buildCorpusIndex } from "./corpusIndex";
import { QuickdrawRecognizer } from "./recognizer";
import { type StoredSketch, writeSnapshot } from "./snapshotFile";

const SKETCHES: readonly StoredSketch[] = [
  ...Array.from({ length: 4 }, (_, index) => ({
    category: "circle",
    keyId: `c${index}`,
    drawing: toSimplified(circleSketch({ x: 128, y: 128 }, 50 + index * 10)),
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    category: "line",
    keyId: `l${index}`,
    drawing: toSimplified(lineSketch({ x: 0, y: index }, { x: 250, y: 20 + index })),
  })),
];

describe("indexPathsFor", () => {
  it("looks beside the snapshot first, then in the data directory", () => {
    expect(indexPathsFor("/app/data/quickdraw.ndjson.gz", "/data")).toEqual([
      "/app/data/quickdraw.features.bin",
      "/data/quickdraw.features.bin",
    ]);
    expect(indexPathsFor("/data/quickdraw.ndjson.gz", "/data")).toEqual([
      "/data/quickdraw.features.bin",
    ]);
  });
});

describe("loadQuickdrawCorpus", () => {
  let directory: string;
  let snapshot: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "kami-corpus-"));
    snapshot = join(directory, "quickdraw.ndjson.gz");
    await writeSnapshot(SKETCHES, snapshot);
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("computes the features once, caches them, and reads the cache from then on", async () => {
    const paths = [join(directory, "cache", "quickdraw.features.bin")];
    const first = await loadQuickdrawCorpus(snapshot, paths);
    expect(first.description).toContain("features computed");
    expect(first.description).toContain(`cached in ${paths[0]}`);

    const second = await loadQuickdrawCorpus(snapshot, paths);
    expect(second.description).toContain(`features read from ${paths[0]}`);
    expect(second.corpus.size).toBe(8);
    expect(plainMatrix(second.corpus.matrix)).toEqual(
      plainMatrix(buildCorpusIndex(SKETCHES).matrix),
    );
    expect(
      new QuickdrawRecognizer(second.corpus.matrix).recognize(circleSketch({ x: 0, y: 0 }, 9))[0],
    ).toBe("circle");
  });

  it("recomputes when the snapshot changes under a cached index", async () => {
    const moved = join(directory, "moved.ndjson.gz");
    const paths = [join(directory, "moved.features.bin")];
    await writeSnapshot(SKETCHES, moved);
    await loadQuickdrawCorpus(moved, paths);
    await writeSnapshot(SKETCHES.slice(0, 5), moved);
    const reloaded = await loadQuickdrawCorpus(moved, paths);
    expect(reloaded.description).toContain("features computed");
    expect(reloaded.corpus.size).toBe(5);
  });

  it("caches in the next place when the first cannot be written", async () => {
    const notADirectory = join(directory, "a-file");
    await writeFile(notADirectory, "");
    const fallback = join(directory, "data", "quickdraw.features.bin");
    const loaded = await loadQuickdrawCorpus(snapshot, [
      join(notADirectory, "quickdraw.features.bin"),
      fallback,
    ]);
    expect(loaded.description).toContain(`cached in ${fallback}`);
  });

  it("is empty, and says why, without a snapshot or with a broken one", async () => {
    const missing = await loadQuickdrawCorpus(join(directory, "none.ndjson.gz"), []);
    expect(missing.corpus.size).toBe(0);
    expect(missing.description).toContain("quickdraw:ingest");

    const broken = join(directory, "broken.ndjson.gz");
    await writeFile(broken, "not gzip");
    const unreadable = await loadQuickdrawCorpus(broken, []);
    expect(unreadable.corpus.size).toBe(0);
    expect(unreadable.description).toContain("could not read");
  });
});

describe("QuickdrawCorpus", () => {
  it("summons one of a category's kept drawings, and nothing for a category it lacks", async () => {
    const index = buildCorpusIndex(SKETCHES, 2);
    const corpus = new QuickdrawCorpus(index, () => 0.99);
    expect(await corpus.anyOf("circle")).toBe(index.summons.get("circle")?.[1]);
    expect(await corpus.anyOf("dragon")).toBeNull();
    expect(await QuickdrawCorpus.empty.anyOf("circle")).toBeNull();
  });
});
