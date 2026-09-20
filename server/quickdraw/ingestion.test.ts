// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../db/connect";
import { Binary } from "../db/mongo";
import { startMemoryDatabase } from "../testing/memoryDatabase";
import { circleSketch, lineSketch } from "../testing/sketches";
import { toStrokes } from "./dataset";
import { computeFeature, FEATURE_LENGTH } from "./feature";
import { reindexStoredSketches } from "./indexing";
import { ingestQuickdraw } from "./ingestion";
import { COMPLETE_FRACTION, PREFIX_FRACTIONS, prefixOfStrokes } from "./prefix";
import { type LabelledFeature, QuickdrawRecognizer } from "./recognizer";
import { QuickdrawSampleRepository } from "./sampleRepository";

const GRID_MAX = 255;

const toSimplified = (strokes: ReturnType<typeof circleSketch>): number[][][] =>
  strokes.map((stroke) => [
    stroke.map(({ x }) => Math.round(x)),
    stroke.map(({ y }) => Math.round(y)),
  ]);

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

const wholeDrawings = (features: readonly LabelledFeature[]): readonly LabelledFeature[] =>
  features.filter(({ fraction }) => fraction === COMPLETE_FRACTION);

const fakeDataset = async (url: string): Promise<Response> =>
  new Response(ndjsonOf(url.includes("circle") ? "circle" : "line", 20), { status: 206 });

let connection: DatabaseConnection;

beforeAll(async () => {
  connection = await startMemoryDatabase();
}, 120_000);

afterAll(async () => {
  await connection.close();
});

describe("ingestQuickdraw", () => {
  it("stores features that survive MongoDB and recognise sketches", async () => {
    const repository = new QuickdrawSampleRepository(connection.db);
    const reports = await ingestQuickdraw(repository, ["circle", "line"], 12, fakeDataset);
    expect([...reports].sort((a, b) => a.category.localeCompare(b.category))).toEqual([
      { category: "circle", samples: 12 },
      { category: "line", samples: 12 },
    ]);

    const features = await repository.loadFeatures();
    expect(wholeDrawings(features)).toHaveLength(24);
    expect(features.every(({ feature }) => feature.length === FEATURE_LENGTH)).toBe(true);
    expect(new QuickdrawRecognizer(features).recognize(circleSketch({ x: 0, y: 0 }, 500))[0]).toBe(
      "circle",
    );
  });

  it("indexes every drawing at each prefix share, so a half-drawn circle is already a circle", async () => {
    const repository = new QuickdrawSampleRepository(connection.db);
    await ingestQuickdraw(repository, ["circle", "line"], 12, fakeDataset);
    const circles = (await repository.loadFeatures()).filter(
      ({ category }) => category === "circle",
    );
    expect(circles.map(({ fraction }) => fraction).sort()).toEqual(
      Array.from({ length: 12 }, () => PREFIX_FRACTIONS)
        .flat()
        .sort(),
    );

    const halfDrawn = prefixOfStrokes(circleSketch({ x: 40, y: 900 }, 300), 0.5);
    const recognizer = new QuickdrawRecognizer(await repository.loadFeatures());
    expect(recognizer.recognize(halfDrawn, { partial: true })[0]).toBe("circle");
  });

  it("is repeatable, shrinks to a smaller N and forgets dropped categories", async () => {
    const repository = new QuickdrawSampleRepository(connection.db);
    await ingestQuickdraw(repository, ["circle", "line"], 12, fakeDataset);
    await ingestQuickdraw(repository, ["circle"], 5, fakeDataset);
    const features = await repository.loadFeatures();
    expect(new Set(features.map(({ category }) => category))).toEqual(new Set(["circle"]));
    expect(wholeDrawings(features)).toHaveLength(5);
    expect((await repository.keyIdsOf("circle")).size).toBe(5);
  });

  it("hands out any one stored drawing of a category, and nothing for a category it lacks", async () => {
    const repository = new QuickdrawSampleRepository(connection.db);
    await ingestQuickdraw(repository, ["circle"], 3, fakeDataset);
    const picked = await repository.anyOf("circle");
    expect(picked?.category).toBe("circle");
    expect(picked?.keyId).toMatch(/^circle-[0-2]$/);
    expect(picked?.drawing.length).toBeGreaterThan(0);
    expect(await repository.anyOf("line")).toBeNull();
  });
});

describe("reindexStoredSketches", () => {
  it("gives sketches stored before prefixes existed their prefix rows, from the database alone", async () => {
    const drawing = toSimplified(circleSketch({ x: 128, y: 128 }, 100));
    const legacy = computeFeature(toStrokes(drawing as [number[], number[]][]));
    const collection = connection.db.collection("quickdraw");
    await collection.deleteMany({});
    await collection.insertOne({
      category: "circle",
      keyId: "stored-long-ago",
      drawing,
      feature: new Binary(new Uint8Array(legacy.buffer)),
    });

    const repository = new QuickdrawSampleRepository(connection.db);
    expect((await repository.loadFeatures()).map(({ fraction }) => fraction)).toEqual([
      COMPLETE_FRACTION,
    ]);

    expect(await reindexStoredSketches(repository)).toBe(1);
    const features = await repository.loadFeatures();
    expect(features.map(({ fraction }) => fraction)).toEqual([...PREFIX_FRACTIONS]);
    expect(Array.from(wholeDrawings(features)[0]?.feature ?? [])).toEqual(Array.from(legacy));
    expect(await collection.countDocuments({ feature: { $exists: true } })).toBe(0);
  });
});
