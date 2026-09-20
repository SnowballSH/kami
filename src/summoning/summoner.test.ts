import { describe, expect, it } from "vitest";
import { boundsOf, type Stroke } from "../core/geometry";
import type { Exemplar } from "../recognition";
import { SUMMONED_SIZE } from "./layout";
import { type PictureSource, type SketchCatalogue, Summoner } from "./summoner";

const SQUARE: readonly Stroke[] = [
  [
    { x: 0, y: 0 },
    { x: 255, y: 0 },
    { x: 255, y: 255 },
    { x: 0, y: 255 },
  ],
];

class FakeServer implements SketchCatalogue, PictureSource {
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

  exemplar(word: string): Promise<Exemplar | null> {
    this.asked.push(word);
    return Promise.resolve(this.missing.has(word) ? null : { word, strokes: SQUARE });
  }
}

const summonerOf = (server: FakeServer) => new Summoner(server, server);

describe("Summoner", () => {
  it("fetches the catalogue once and reads wishes against it", async () => {
    const server = new FakeServer(["rabbit", "house"]);
    const summoner = summonerOf(server);
    summoner.wake();
    expect(await summoner.wish("summon a rabbit")).toEqual({
      summons: [{ category: "rabbit", count: 1 }],
      explicit: true,
      asked: "a rabbit",
    });
    expect(await summoner.wish("a unicorn")).toBeNull();
    expect(server.catalogueAsked).toBe(1);
  });

  it("asks for the catalogue again while the server has none", async () => {
    const server = new FakeServer([]);
    const summoner = summonerOf(server);
    expect(await summoner.wish("a rabbit")).toBeNull();
    expect(await summoner.wish("a rabbit")).toBeNull();
    expect(server.catalogueAsked).toBe(2);
  });

  it("draws each thing to size in a row standing over the words, skipping what it cannot fetch", async () => {
    const server = new FakeServer(["rabbit", "house", "key"], new Set(["key"]));
    const summoner = summonerOf(server);
    const wish = await summoner.wish("two rabbits, a key and a house");
    if (wish === null) throw new Error("not a wish");

    const writing = { x: 100, y: 500, width: 200, height: 30 };
    const summoned = await summoner.conjure(wish, writing, null);
    expect(server.asked).toEqual(["rabbit", "rabbit", "key", "house"]);
    expect(summoned.map(({ word }) => word)).toEqual(["rabbit", "rabbit", "house"]);
    const [first, second, house] = summoned.map(({ strokes }) => boundsOf(strokes.flat()));
    expect(first).toMatchObject({ width: SUMMONED_SIZE.usual, height: SUMMONED_SIZE.usual });
    expect(second?.x).toBeGreaterThan((first?.x ?? 0) + (first?.width ?? 0));
    expect(house?.width).toBe(SUMMONED_SIZE.big);
    const bottom = (house?.y ?? 0) + (house?.height ?? 0);
    expect(bottom).toBe((first?.y ?? 0) + (first?.height ?? 0));
    expect(bottom).toBeLessThan(500);
    const all = boundsOf(summoned.flatMap(({ strokes }) => strokes.flat()));
    expect(all.x + all.width / 2).toBeCloseTo(200, 5);
  });

  it("lifts the row clear of Alice when she stands where it would land", async () => {
    const server = new FakeServer(["rabbit"]);
    const summoner = summonerOf(server);
    const wish = await summoner.wish("a rabbit");
    if (wish === null) throw new Error("not a wish");

    const writing = { x: 100, y: 500, width: 200, height: 30 };
    const alice = { x: 180, y: 400, width: 40, height: 60 };
    const [rabbit] = await summoner.conjure(wish, writing, alice);
    const drawn = boundsOf(rabbit?.strokes.flat() ?? []);
    expect(drawn.y + drawn.height).toBeLessThan(alice.y);
  });
});
