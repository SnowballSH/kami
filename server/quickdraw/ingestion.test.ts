// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../db/connect";
import { startMemoryDatabase } from "../testing/memoryDatabase";
import { circleSketch, lineSketch } from "../testing/sketches";
import { FEATURE_LENGTH } from "./feature";
import { ingestQuickdraw } from "./ingestion";
import { QuickdrawRecognizer } from "./recognizer";
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
    expect(features).toHaveLength(24);
    expect(features.every(({ feature }) => feature.length === FEATURE_LENGTH)).toBe(true);
    expect(new QuickdrawRecognizer(features).recognize(circleSketch({ x: 0, y: 0 }, 500))[0]).toBe(
      "circle",
    );
  });

  it("is repeatable, shrinks to a smaller N and forgets dropped categories", async () => {
    const repository = new QuickdrawSampleRepository(connection.db);
    await ingestQuickdraw(repository, ["circle", "line"], 12, fakeDataset);
    await ingestQuickdraw(repository, ["circle"], 5, fakeDataset);
    const features = await repository.loadFeatures();
    expect(features.map(({ category }) => category)).toEqual(Array(5).fill("circle"));
    expect((await repository.keyIdsOf("circle")).size).toBe(5);
  });
});
