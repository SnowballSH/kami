import { describe, expect, it } from "vitest";
import { MOST_SUMMONED, parseWish } from "./grammar";
import { SummoningLexicon } from "./lexicon";

const lexicon = new SummoningLexicon([
  "rabbit",
  "house",
  "tree",
  "bush",
  "river",
  "cloud",
  "star",
  "apple",
  "hot air balloon",
  "teddy-bear",
  "The Eiffel Tower",
  "mouse",
  "rain",
]);

const summoned = (text: string): string[] | null =>
  parseWish(text, lexicon)?.summons.map(({ category, count }) => `${count} ${category}`) ?? null;

describe("parseWish", () => {
  it("reads a plain wish for one thing, with or without asking", () => {
    expect(parseWish("summon a rabbit", lexicon)).toEqual({
      summons: [{ category: "rabbit", count: 1 }],
      explicit: true,
    });
    expect(parseWish("a rabbit", lexicon)).toEqual({
      summons: [{ category: "rabbit", count: 1 }],
      explicit: false,
    });
    expect(parseWish("Summon a rabbit!", lexicon)?.explicit).toBe(true);
    expect(parseWish("give me a hot air balloon, please", lexicon)?.summons).toEqual([
      { category: "hot air balloon", count: 1 },
    ]);
    expect(parseWish("kami, i want a rabbit", lexicon)?.explicit).toBe(true);
  });

  it("counts: numerals, words for a few, and bare plurals", () => {
    expect(summoned("three rabbits")).toEqual(["3 rabbit"]);
    expect(summoned("2 houses")).toEqual(["2 house"]);
    expect(summoned("a couple of houses")).toEqual(["2 house"]);
    expect(summoned("a few trees")).toEqual(["3 tree"]);
    expect(summoned("lots of stars")).toEqual(["4 star"]);
    expect(summoned("rabbits")).toEqual(["2 rabbit"]);
    expect(summoned("mice")).toEqual(["2 mouse"]);
    expect(summoned("the rabbit")).toEqual(["1 rabbit"]);
  });

  it("joins several things with commas, 'and' and prepositions", () => {
    expect(summoned("draw a house and a tree")).toEqual(["1 house", "1 tree"]);
    expect(summoned("a house, a tree & two clouds")).toEqual(["1 house", "1 tree", "2 cloud"]);
    expect(summoned("a bridge over a river")).toBeNull();
    expect(summoned("a house beside a river")).toEqual(["1 house", "1 river"]);
    expect(summoned("a house with a tree and a tree")).toEqual(["1 house", "2 tree"]);
  });

  it("knows scene words and draws what the library has of them", () => {
    expect(summoned("a forest")).toEqual(["3 tree", "1 bush"]);
    expect(summoned("a forest with a river")).toEqual(["3 tree", "1 bush", "1 river"]);
    expect(summoned("a farm")).toBeNull();
  });

  it("lets a couple of adjectives through but not pronouns", () => {
    expect(summoned("a big red apple")).toEqual(["1 apple"]);
    expect(summoned("a very big red apple")).toBeNull();
    expect(summoned("make it rain")).toBeNull();
    expect(summoned("make alice a rabbit")).toBeNull();
  });

  it("matches names however they are spaced or capitalised", () => {
    expect(summoned("a teddy bear")).toEqual(["1 teddy-bear"]);
    expect(summoned("teddybear")).toEqual(["1 teddy-bear"]);
    expect(summoned("the eiffel tower")).toEqual(["1 The Eiffel Tower"]);
    expect(summoned("HOT AIR BALLOONS")).toEqual(["2 hot air balloon"]);
  });

  it("is not a wish when any word is not a thing", () => {
    for (const text of [
      "no gravity",
      "make alice fly",
      "hi",
      "summon",
      "a",
      "summon a unicorn",
      "a rabbit that flies",
      "a rabbit and",
      "",
    ]) {
      expect(parseWish(text, lexicon), text).toBeNull();
    }
  });

  it("caps a wish at a handful of things", () => {
    expect(summoned("a dozen rabbits and a house")).toEqual([`${MOST_SUMMONED} rabbit`]);
    expect(summoned("6 rabbits and 6 houses")).toEqual(["6 rabbit", "2 house"]);
  });

  it("wishes for nothing from an empty library", () => {
    expect(parseWish("summon a rabbit", new SummoningLexicon([]))).toBeNull();
  });
});
