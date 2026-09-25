// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../db/connect";
import { startMemoryDatabase } from "../testing/memoryDatabase";
import type { SimplifiedStroke } from "./dataset";
import { sampleOf } from "./indexing";
import { QuickdrawSampleRepository } from "./sampleRepository";
import { describeSeed, seedQuickdraw } from "./seed";
import { exportSnapshot } from "./snapshotFile";

const LINE: readonly SimplifiedStroke[] = [
  [
    [0, 255],
    [10, 10],
  ],
];

describe("seedQuickdraw", () => {
  let connection: DatabaseConnection;
  let directory: string;
  let snapshot: string;

  beforeAll(async () => {
    connection = await startMemoryDatabase();
    directory = await mkdtemp(join(tmpdir(), "kami-seed-"));
    snapshot = join(directory, "quickdraw.ndjson.gz");
    const source = new QuickdrawSampleRepository(connection.db);
    await source.ensureIndexes();
    await source.upsertCategory("line", [
      sampleOf({ category: "line", keyId: "1", drawing: LINE }),
    ]);
    await exportSnapshot(source, snapshot);
    await connection.db.collection("quickdraw").drop();
  }, 120_000);

  afterAll(async () => {
    await connection.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("does nothing without a snapshot", async () => {
    const repository = new QuickdrawSampleRepository(connection.db);
    expect(await seedQuickdraw(repository, null)).toEqual({ kind: "none" });
    expect(await repository.isEmpty()).toBe(true);
  });

  it("fills an empty database from the snapshot, once, and then keeps what is there", async () => {
    const repository = new QuickdrawSampleRepository(connection.db);
    expect(await seedQuickdraw(repository, snapshot)).toEqual({ kind: "imported", sketches: 1 });
    expect(await repository.isEmpty()).toBe(false);
    await repository.upsertCategory("square", [
      sampleOf({ category: "square", keyId: "9", drawing: LINE }),
    ]);
    expect(await seedQuickdraw(repository, snapshot)).toEqual({ kind: "kept" });
    expect((await repository.loadDrawings()).map(({ category }) => category)).toEqual([
      "line",
      "square",
    ]);
  });

  it("reports a missing or broken file instead of failing start-up", async () => {
    await connection.db.collection("quickdraw").drop();
    const repository = new QuickdrawSampleRepository(connection.db);
    const outcome = await seedQuickdraw(repository, join(directory, "missing.ndjson.gz"));
    expect(outcome.kind).toBe("failed");
    expect(describeSeed(outcome, "missing.ndjson.gz")).toContain("could not import");
    expect(describeSeed({ kind: "none" }, null)).toContain("KAMI_QUICKDRAW_SNAPSHOT");
  });
});
