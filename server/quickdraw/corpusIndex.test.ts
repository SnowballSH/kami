// @vitest-environment node
import { describe, expect, it } from "vitest";
import { circleSketch, lineSketch, toSimplified } from "../testing/sketches";
import { buildCorpusIndex, corpusIndexKey } from "./corpusIndex";
import { toStrokes } from "./dataset";
import { buildFeatureMatrix } from "./featureMatrix";
import { prefixFeaturesOf } from "./prefixFeatures";
import type { StoredSketch } from "./snapshotFile";

const circle = (index: number): StoredSketch => ({
  category: "circle",
  keyId: `circle-${index}`,
  drawing: toSimplified(circleSketch({ x: 128, y: 128 }, 60 + index * 4, index * 0.05)),
});

const line = (index: number): StoredSketch => ({
  category: "line",
  keyId: `line-${index}`,
  drawing: toSimplified(lineSketch({ x: 0, y: index * 9 }, { x: 250, y: 200 - index * 9 })),
});

const SKETCHES: readonly StoredSketch[] = [
  ...Array.from({ length: 6 }, (_, index) => circle(index)),
  ...Array.from({ length: 5 }, (_, index) => line(index)),
  { category: "line", keyId: "dot", drawing: [[[3], [4]]] },
];

describe("buildCorpusIndex", () => {
  it("builds exactly the matrix the prefix features of every sketch make, row for row", () => {
    const expected = buildFeatureMatrix(
      SKETCHES.flatMap(({ category, drawing }) =>
        prefixFeaturesOf(toStrokes(drawing)).map(({ fraction, feature }) => ({
          category,
          fraction,
          feature,
        })),
      ),
    );
    const { matrix } = buildCorpusIndex(SKETCHES);
    expect(matrix.categories).toEqual(expected.categories);
    expect(matrix.completeRows).toBe(SKETCHES.length);
    expect(matrix.completeRows).toBe(expected.completeRows);
    expect(Array.from(matrix.rowCategories)).toEqual(Array.from(expected.rowCategories));
    expect(Array.from(matrix.features)).toEqual(Array.from(expected.features));
    expect(matrix.features.buffer).toBeInstanceOf(SharedArrayBuffer);
  });

  it("keeps a few well-formed drawings per category to summon, the most typical first", () => {
    const { summons } = buildCorpusIndex(SKETCHES, 3);
    expect([...summons.keys()]).toEqual(["circle", "line"]);
    expect(summons.get("circle")).toHaveLength(3);
    const lines = summons.get("line") ?? [];
    expect(lines).toHaveLength(3);
    expect(lines.map(({ keyId }) => keyId)).not.toContain("dot");
    expect(buildCorpusIndex(SKETCHES, 10).summons.get("line")).toHaveLength(5);
  });

  it("is empty for an empty corpus", () => {
    const { matrix, summons } = buildCorpusIndex([]);
    expect(matrix.completeRows).toBe(0);
    expect(matrix.features).toHaveLength(0);
    expect(summons.size).toBe(0);
  });
});

describe("corpusIndexKey", () => {
  it("names the snapshot it was built from", () => {
    const one = new TextEncoder().encode("one");
    expect(corpusIndexKey(one)).toBe(corpusIndexKey(new TextEncoder().encode("one")));
    expect(corpusIndexKey(one)).not.toBe(corpusIndexKey(new TextEncoder().encode("two")));
  });
});
