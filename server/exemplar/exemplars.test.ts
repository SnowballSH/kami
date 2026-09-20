// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createNatureTable } from "../natures/natureTable";
import type { StoredSketch } from "../quickdraw/sampleRepository";
import { categoryOf, createExemplarSource } from "./exemplars";

const natures = createNatureTable({
  rabbit: { name: "a rabbit", nature: "hopper", strength: 1, line: "Late, always." },
  "hot air balloon": { name: "a hot air balloon", nature: "floaty", strength: 1.3, line: "Up." },
  "birthday cake": {
    name: "a birthday cake",
    nature: "ink",
    strength: 1,
    alias: "cake",
    line: "Cake.",
  },
  cake: { name: "a cake", nature: "ink", strength: 1, line: "Cake." },
  bus: { name: "a bus", nature: "vehicle", strength: 1, line: "Late too." },
  cherry: { name: "a cherry", nature: "ink", strength: 1, line: "Two, usually." },
});

const RABBIT: StoredSketch = {
  category: "rabbit",
  keyId: "1",
  drawing: [
    [
      [0, 10, 20],
      [5, 15, 25],
    ],
    [
      [255, 200],
      [0, 255],
    ],
  ],
};

const picker = (sketches: readonly StoredSketch[]) => {
  const asked: string[] = [];
  return {
    asked,
    anyOf: async (category: string) => {
      asked.push(category);
      return sketches.find((sketch) => sketch.category === category) ?? null;
    },
  };
};

describe("categoryOf", () => {
  it("hears the category through articles, plurals and case", () => {
    expect(categoryOf("Rabbit", natures)).toBe("rabbit");
    expect(categoryOf("a rabbit", natures)).toBe("rabbit");
    expect(categoryOf("some rabbits", natures)).toBe("rabbit");
    expect(categoryOf("the hot air balloon", natures)).toBe("hot air balloon");
    expect(categoryOf("hot-air balloons", natures)).toBe("hot air balloon");
    expect(categoryOf("buses", natures)).toBe("bus");
    expect(categoryOf("cherries", natures)).toBe("cherry");
  });

  it("keeps an aliased category as its own picture", () => {
    expect(categoryOf("a birthday cake", natures)).toBe("birthday cake");
  });

  it("has no category for words it has never drawn", () => {
    expect(categoryOf("a unicorn", natures)).toBeNull();
    expect(categoryOf("", natures)).toBeNull();
    expect(categoryOf("the", natures)).toBeNull();
  });
});

describe("createExemplarSource", () => {
  it("answers a stored sketch of the word as strokes in the 256 px frame", async () => {
    const sketches = picker([RABBIT]);
    const exemplar = await createExemplarSource(sketches, natures).exemplar("some Rabbits");
    expect(sketches.asked).toEqual(["rabbit"]);
    expect(exemplar).toEqual({
      word: "rabbit",
      strokes: [
        [
          { x: 0, y: 5 },
          { x: 10, y: 15 },
          { x: 20, y: 25 },
        ],
        [
          { x: 255, y: 0 },
          { x: 200, y: 255 },
        ],
      ],
    });
  });

  it("is null for an unknown word without asking the store", async () => {
    const sketches = picker([RABBIT]);
    expect(await createExemplarSource(sketches, natures).exemplar("a unicorn")).toBeNull();
    expect(sketches.asked).toEqual([]);
  });

  it("is null for a known word nobody has ingested yet", async () => {
    expect(await createExemplarSource(picker([]), natures).exemplar("a bus")).toBeNull();
  });

  it("is null for a sketch that is not strokes", async () => {
    const dotted = picker([{ ...RABBIT, drawing: [[[3], [4]]] }]);
    expect(await createExemplarSource(dotted, natures).exemplar("rabbit")).toBeNull();
  });
});
