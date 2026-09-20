import { describe, expect, it } from "vitest";
import { boundsOf, type Stroke } from "../core/geometry";
import type { SketchLibrary } from "../persistence/types";
import { SUMMONED_SIZE } from "./layout";
import { Summoner } from "./summoner";

const SQUARE: readonly Stroke[] = [
  [
    { x: 0, y: 0 },
    { x: 255, y: 0 },
    { x: 255, y: 255 },
    { x: 0, y: 255 },
  ],
];

class FakeLibrary implements SketchLibrary {
  catalogueAsked = 0;
  readonly asked: string[] = [];

  constructor(
    private readonly known: readonly string[],
    private readonly missing: ReadonlySet<string> = new Set(),
  ) {}

  categories(): Promise<readonly string[]> {
    this.catalogueAsked += 1;
    return Promise.resolve(this.known);
  }

  sketch(category: string): Promise<readonly Stroke[] | null> {
    this.asked.push(category);
    return Promise.resolve(this.missing.has(category) ? null : SQUARE);
  }
}

describe("Summoner", () => {
  it("fetches the catalogue once and reads wishes against it", async () => {
    const library = new FakeLibrary(["rabbit", "house"]);
    const summoner = new Summoner(library);
    summoner.wake();
    expect(await summoner.wish("summon a rabbit")).toEqual({
      summons: [{ category: "rabbit", count: 1 }],
      explicit: true,
    });
    expect(await summoner.wish("a unicorn")).toBeNull();
    expect(library.catalogueAsked).toBe(1);
  });

  it("asks for the catalogue again while the server has none", async () => {
    const library = new FakeLibrary([]);
    const summoner = new Summoner(library);
    expect(await summoner.wish("a rabbit")).toBeNull();
    expect(await summoner.wish("a rabbit")).toBeNull();
    expect(library.catalogueAsked).toBe(2);
  });

  it("draws each thing to size in a row below the origin, skipping what it cannot fetch", async () => {
    const library = new FakeLibrary(["rabbit", "house", "key"], new Set(["key"]));
    const summoner = new Summoner(library);
    const wish = await summoner.wish("two rabbits, a key and a house");
    if (wish === null) throw new Error("not a wish");

    const summoned = await summoner.conjure(wish, { x: 100, y: 50 });
    expect(library.asked).toEqual(["rabbit", "rabbit", "key", "house"]);
    expect(summoned.map(({ category }) => category)).toEqual(["rabbit", "rabbit", "house"]);
    const [first, second, house] = summoned.map(({ strokes }) => boundsOf(strokes.flat()));
    expect(first).toMatchObject({
      x: 100,
      width: SUMMONED_SIZE.usual,
      height: SUMMONED_SIZE.usual,
    });
    expect(second?.x).toBeGreaterThan((first?.x ?? 0) + (first?.width ?? 0));
    expect(house?.width).toBe(SUMMONED_SIZE.big);
    expect(first?.y).toBeGreaterThanOrEqual(50);
    expect((house?.y ?? 0) + (house?.height ?? 0)).toBe((first?.y ?? 0) + (first?.height ?? 0));
  });
});
