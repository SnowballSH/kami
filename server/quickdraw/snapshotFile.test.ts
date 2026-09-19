// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../db/connect";
import { startMemoryDatabase } from "../testing/memoryDatabase";
import type { SimplifiedStroke } from "./dataset";
import { toStrokes } from "./dataset";
import { computeFeature } from "./feature";
import { QuickdrawSampleRepository } from "./sampleRepository";
import { exportSnapshot, importSnapshot } from "./snapshotFile";

const LINE: readonly SimplifiedStroke[] = [
  [
    [0, 255],
    [10, 10],
  ],
];
const BOX: readonly SimplifiedStroke[] = [
  [
    [0, 200, 200, 0, 0],
    [0, 0, 200, 200, 0],
  ],
];

const sample = (category: string, keyId: string, drawing: readonly SimplifiedStroke[]) => ({
  category,
  keyId,
  drawing,
  feature: computeFeature(toStrokes(drawing)),
});

describe("Quick, Draw! snapshot", () => {
  let source: DatabaseConnection;
  let destination: DatabaseConnection;
  let directory: string;

  beforeAll(async () => {
    [source, destination] = await Promise.all([startMemoryDatabase(), startMemoryDatabase()]);
    directory = await mkdtemp(join(tmpdir(), "kami-snapshot-"));
  }, 120_000);

  afterAll(async () => {
    await Promise.all([source.close(), destination.close()]);
    await rm(directory, { recursive: true, force: true });
  });

  it("carries what one machine ingested to a machine with no internet", async () => {
    const ingested = new QuickdrawSampleRepository(source.db);
    await ingested.ensureIndexes();
    await ingested.upsertCategory("line", [sample("line", "1", LINE), sample("line", "2", LINE)]);
    await ingested.upsertCategory("square", [sample("square", "3", BOX)]);

    const file = join(directory, "quickdraw.ndjson.gz");
    expect(await exportSnapshot(ingested, file)).toBe(3);

    const offline = new QuickdrawSampleRepository(destination.db);
    expect(await importSnapshot(offline, file)).toBe(3);
    expect(await importSnapshot(offline, file)).toBe(3);

    const features = await offline.loadFeatures();
    expect(features.map(({ category }) => category).sort()).toEqual(["line", "line", "square"]);
    const square = features.find(({ category }) => category === "square");
    expect(Array.from(square?.feature ?? [])).toEqual(Array.from(computeFeature(toStrokes(BOX))));
  });
});
