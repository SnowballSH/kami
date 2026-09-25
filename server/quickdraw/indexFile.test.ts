// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { plainMatrix } from "../testing/matrices";
import { circleSketch, lineSketch, toSimplified } from "../testing/sketches";
import { buildCorpusIndex, type CorpusIndex } from "./corpusIndex";
import { readIndexFile, writeIndexFile } from "./indexFile";

const INDEX: CorpusIndex = buildCorpusIndex([
  { category: "circle", keyId: "1", drawing: toSimplified(circleSketch({ x: 99, y: 99 }, 80)) },
  { category: "circle", keyId: "2", drawing: toSimplified(circleSketch({ x: 90, y: 90 }, 60)) },
  {
    category: "line",
    keyId: "3",
    drawing: toSimplified(lineSketch({ x: 0, y: 0 }, { x: 200, y: 9 })),
  },
]);

describe("corpus index file", () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "kami-index-"));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("reads back the very matrix and summons it was given, in shared memory", async () => {
    const file = join(directory, "sub", "quickdraw.features.bin");
    await writeIndexFile(file, "key-1", INDEX);
    const read = await readIndexFile(file, "key-1");
    if (read === null) throw new Error("index not read back");
    expect(plainMatrix(read.matrix)).toEqual(plainMatrix(INDEX.matrix));
    expect(read.matrix.values.buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(read.summons).toEqual(INDEX.summons);
  });

  it("is null for another key, a missing file, a foreign file or a cut-short one", async () => {
    const file = join(directory, "quickdraw.features.bin");
    await writeIndexFile(file, "key-1", INDEX);
    expect(await readIndexFile(file, "key-2")).toBeNull();
    expect(await readIndexFile(join(directory, "missing.bin"), "key-1")).toBeNull();

    const foreign = join(directory, "foreign.bin");
    await writeFile(foreign, "not an index at all");
    expect(await readIndexFile(foreign, "key-1")).toBeNull();

    const whole = await readFile(file);
    const cut = join(directory, "cut.bin");
    await writeFile(cut, whole.subarray(0, whole.length - 100));
    expect(await readIndexFile(cut, "key-1")).toBeNull();
  });
});
