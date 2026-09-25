// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lineSketch } from "../testing/sketches";
import { buildSnapshot } from "./buildSnapshot";
import { readSnapshot } from "./snapshotFile";

const GRID_MAX = 255;

const ndjsonOf = (category: string, count: number): string =>
  `${Array.from({ length: count }, (_, index) =>
    JSON.stringify({
      word: category,
      recognized: true,
      key_id: `${category}-${index}`,
      drawing: lineSketch({ x: 0, y: index }, { x: GRID_MAX, y: index * 2 }).map((stroke) => [
        stroke.map(({ x }) => Math.round(x)),
        stroke.map(({ y }) => Math.round(y)),
      ]),
    }),
  ).join("\n")}\n`;

const fakeDataset = async (url: string): Promise<Response> =>
  new Response(ndjsonOf(url.includes("circle") ? "circle" : "line", 20), { status: 206 });

describe("buildSnapshot", () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "kami-build-snapshot-"));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("writes the dataset straight to a snapshot, sorted, with no database in the way", async () => {
    const file = join(directory, "nested", "quickdraw.ndjson.gz");
    const reported: string[] = [];
    const count = await buildSnapshot(file, {
      categories: ["line", "circle"],
      samplesPerCategory: 3,
      fetchFn: fakeDataset,
      log: (line) => reported.push(line),
    });
    expect(count).toBe(6);
    expect(reported.sort()).toEqual(["circle: 3 drawings", "line: 3 drawings"]);

    const sketches = await readSnapshot(file);
    expect(sketches.map(({ category, keyId }) => `${category}/${keyId}`)).toEqual([
      "circle/circle-0",
      "circle/circle-1",
      "circle/circle-2",
      "line/line-0",
      "line/line-1",
      "line/line-2",
    ]);
    expect(sketches[0]?.drawing[0]?.[0]).toHaveLength(2);
  });
});
