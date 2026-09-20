// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { StoredSketch } from "../quickdraw/sampleRepository";
import { FirstAnswering, StoredLibrary } from "./storedLibrary";
import type { Sketch, SketchLibrary } from "./types";

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

const store = (sketches: readonly StoredSketch[]) => ({
  anyOf: async (category: string) =>
    sketches.find((sketch) => sketch.category === category) ?? null,
});

const shelf = (categories: readonly string[], sketches: readonly Sketch[]): SketchLibrary => ({
  categories,
  pick: async (category) => sketches.find((sketch) => sketch.category === category) ?? null,
  describe: () => categories.join("+"),
});

describe("StoredLibrary", () => {
  it("answers an ingested sample as strokes in the 256 px frame", async () => {
    expect(await new StoredLibrary(store([RABBIT])).pick("rabbit")).toEqual({
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
    });
  });

  it("is null for a category nobody has ingested yet", async () => {
    expect(await new StoredLibrary(store([])).pick("bus")).toBeNull();
  });

  it("is null for a sample that is not strokes", async () => {
    const dotted = store([{ ...RABBIT, drawing: [[[3], [4]]] }]);
    expect(await new StoredLibrary(dotted).pick("rabbit")).toBeNull();
  });
});

describe("FirstAnswering", () => {
  const rabbit: Sketch = {
    category: "rabbit",
    strokes: [
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    ],
  };
  const bus: Sketch = {
    category: "bus",
    strokes: [
      [
        { x: 2, y: 2 },
        { x: 3, y: 3 },
      ],
    ],
  };

  it("unites the catalogues and takes the first library with a drawing", async () => {
    const library = new FirstAnswering([shelf(["rabbit", "bus"], [rabbit]), shelf(["bus"], [bus])]);
    expect(library.categories).toEqual(["rabbit", "bus"]);
    expect(await library.pick("rabbit")).toBe(rabbit);
    expect(await library.pick("bus")).toBe(bus);
    expect(await library.pick("dragon")).toBeNull();
    expect(library.describe()).toBe("rabbit+bus, then bus");
  });
});
