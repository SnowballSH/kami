// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SimplifiedStroke } from "./dataset";
import { readSnapshot, type StoredSketch, writeSnapshot } from "./snapshotFile";

const LINE: readonly SimplifiedStroke[] = [
  [
    [0, 255],
    [10, 10],
  ],
];

const sketch = (category: string, keyId: string): StoredSketch => ({
  category,
  keyId,
  drawing: LINE,
});

describe("Quick, Draw! snapshot", () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "kami-snapshot-"));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("round-trips the drawings, sorted by category and key", async () => {
    const file = join(directory, "deep", "quickdraw.ndjson.gz");
    const written = [sketch("square", "3"), sketch("line", "2"), sketch("line", "1")];
    expect(await writeSnapshot(written, file)).toBe(3);
    expect(await readSnapshot(file)).toEqual([
      sketch("line", "1"),
      sketch("line", "2"),
      sketch("square", "3"),
    ]);
  });

  it("refuses a line that is not a drawing", async () => {
    const file = join(directory, "broken.ndjson.gz");
    await writeFile(file, gzipSync(JSON.stringify({ category: "line", keyId: "1" })));
    await expect(readSnapshot(file)).rejects.toThrow();
  });
});
