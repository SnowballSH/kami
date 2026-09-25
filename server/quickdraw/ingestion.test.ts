// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { circleSketch, lineSketch, toSimplified } from "../testing/sketches";
import { buildCorpusIndex } from "./corpusIndex";
import { ingestQuickdraw } from "./ingestion";
import { PREFIX_FRACTIONS, prefixOfStrokes } from "./prefix";
import { QuickdrawRecognizer } from "./recognizer";
import { readSnapshot } from "./snapshotFile";

const GRID_MAX = 255;

const ndjsonOf = (category: string, count: number): string =>
  `${Array.from({ length: count }, (_, index) =>
    JSON.stringify({
      word: category,
      recognized: true,
      key_id: `${category}-${index}`,
      drawing: toSimplified(
        category === "circle"
          ? circleSketch({ x: 128, y: 128 }, 100 + index, index * 0.01)
          : lineSketch({ x: 0, y: index }, { x: GRID_MAX, y: index * 2 }),
      ),
    }),
  ).join("\n")}\n`;

const fakeDataset = async (url: string): Promise<Response> =>
  new Response(ndjsonOf(url.includes("circle") ? "circle" : "line", 20), { status: 206 });

describe("ingestQuickdraw", () => {
  let directory: string;
  let snapshot: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "kami-ingest-"));
    snapshot = join(directory, "nested", "quickdraw.ndjson.gz");
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("writes the dataset straight to a sorted snapshot the recogniser learns from", async () => {
    const reported: string[] = [];
    const reports = await ingestQuickdraw(snapshot, {
      categories: ["line", "circle"],
      samplesPerCategory: 12,
      fetchFn: fakeDataset,
      log: (line) => reported.push(line),
    });
    expect(reports.toSorted((a, b) => a.category.localeCompare(b.category))).toEqual([
      { category: "circle", samples: 12 },
      { category: "line", samples: 12 },
    ]);
    expect(reported.sort()).toEqual(["circle: 12 drawings", "line: 12 drawings"]);

    const sketches = await readSnapshot(snapshot);
    expect(sketches.slice(0, 3).map(({ keyId }) => keyId)).toEqual([
      "circle-0",
      "circle-1",
      "circle-10",
    ]);
    const recognizer = new QuickdrawRecognizer(buildCorpusIndex(sketches).matrix);
    expect(recognizer.size).toBe(24);
    expect(recognizer.recognize(circleSketch({ x: 0, y: 0 }, 500))[0]).toBe("circle");
  });

  it("indexes every drawing at each prefix share, so a half-drawn circle is already a circle", async () => {
    await ingestQuickdraw(snapshot, {
      categories: ["circle", "line"],
      samplesPerCategory: 12,
      fetchFn: fakeDataset,
    });
    const recognizer = new QuickdrawRecognizer(
      buildCorpusIndex(await readSnapshot(snapshot)).matrix,
    );
    const circleRows = 12 * PREFIX_FRACTIONS.length;
    expect(recognizer.rows).toBeGreaterThanOrEqual(circleRows);

    const halfDrawn = prefixOfStrokes(circleSketch({ x: 40, y: 900 }, 300), 0.5);
    expect(recognizer.recognize(halfDrawn, { partial: true })[0]).toBe("circle");
  });

  it("replaces the snapshot, so a smaller N or fewer categories is what remains", async () => {
    await ingestQuickdraw(snapshot, {
      categories: ["circle", "line"],
      samplesPerCategory: 12,
      fetchFn: fakeDataset,
    });
    await ingestQuickdraw(snapshot, {
      categories: ["circle"],
      samplesPerCategory: 5,
      fetchFn: fakeDataset,
    });
    const sketches = await readSnapshot(snapshot);
    expect(new Set(sketches.map(({ category }) => category))).toEqual(new Set(["circle"]));
    expect(sketches).toHaveLength(5);
  });
});
