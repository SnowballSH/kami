// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createNatureTable } from "../natures/natureTable";
import type { Sketch, SketchLibrary } from "../sketch";
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

const RABBIT: Sketch = {
  category: "rabbit",
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
};

const library = (sketches: readonly Sketch[]) => {
  const asked: string[] = [];
  const shelf: SketchLibrary = {
    categories: ["rabbit", "bus"],
    pick: async (category: string) => {
      asked.push(category);
      return sketches.find((sketch) => sketch.category === category) ?? null;
    },
    describe: () => "test shelf",
  };
  return { asked, shelf };
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
  it("answers a drawing of the word from the library, named by its category", async () => {
    const { asked, shelf } = library([RABBIT]);
    const source = createExemplarSource(shelf, natures);
    expect(source.categories).toEqual(["rabbit", "bus"]);
    expect(await source.exemplar("some Rabbits")).toEqual({
      word: "rabbit",
      strokes: RABBIT.strokes,
    });
    expect(asked).toEqual(["rabbit"]);
  });

  it("is null for an unknown word without asking the library", async () => {
    const { asked, shelf } = library([RABBIT]);
    expect(await createExemplarSource(shelf, natures).exemplar("a unicorn")).toBeNull();
    expect(asked).toEqual([]);
  });

  it("is null for a known word the library has no drawing of", async () => {
    expect(await createExemplarSource(library([]).shelf, natures).exemplar("a bus")).toBeNull();
  });
});
