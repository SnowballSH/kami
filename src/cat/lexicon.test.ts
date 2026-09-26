import { describe, expect, it } from "vitest";
import { FLEERS, FOLLOWERS } from "./lexicon";
import {
  ACCEPTANCE,
  ASK_WHAT_IT_IS,
  forbiddenThingLine,
  NEAR_ENOUGH,
  OFFER_HELP,
  REFUSALS,
  smallestThingLine,
  TAG_LINES,
} from "./lines";
import { KEYWORDS, resolveNature } from "./natureResolver";
import { parsePhrase } from "./phrase";
import { ruleOn } from "./ruling";
import { CANDIDATES } from "./shapeGuesser";

const MAX_WORDS = 15;
const LONGEST_KEYWORD = KEYWORDS.reduce(
  (longest, { keyword }) => (keyword.length > longest.length ? keyword : longest),
  "",
);

const EVERY_LINE: readonly string[] = [
  ASK_WHAT_IT_IS,
  OFFER_HELP,
  NEAR_ENOUGH,
  ...Object.values(REFUSALS),
  ...Object.values(TAG_LINES),
  ...Object.values(ACCEPTANCE).flat(),
  forbiddenThingLine(LONGEST_KEYWORD),
  smallestThingLine(LONGEST_KEYWORD),
];

describe("the Cat's lines", () => {
  it.each(EVERY_LINE)("%j is short and in character", (line) => {
    expect(line.split(/\s+/).length).toBeLessThanOrEqual(MAX_WORDS);
    expect(line).not.toMatch(/error|invalid/i);
  });
});

describe("the lexicon", () => {
  it("gives every keyword exactly one nature", () => {
    const seen = new Map<string, string>();
    const clashes = KEYWORDS.flatMap(({ keyword, stems }) => {
      const stemmed = stems.join(" ");
      const earlier = seen.get(stemmed);
      seen.set(stemmed, keyword);
      return earlier === undefined ? [] : [`${earlier} / ${keyword}`];
    });
    expect(clashes).toEqual([]);
  });

  it("lets the longest match win", () => {
    expect(resolveNature(parsePhrase("a bowling ball"))?.nature).toBe("heavy");
    expect(resolveNature(parsePhrase("a hot air balloon"))?.keyword).toBe("hot air balloon");
    expect(resolveNature(parsePhrase("peanut butter"))?.nature).toBe("sticky");
  });

  it("lets the player's own adjective overrule the noun, but keeps the noun for the line", () => {
    expect(resolveNature(parsePhrase("a bouncy balloon"))).toMatchObject({ nature: "bouncy" });
    expect(resolveNature(parsePhrase("a heavy feather"))).toMatchObject({ nature: "heavy" });
    expect(resolveNature(parsePhrase("a bouncy mushroom"))).toEqual({
      nature: "bouncy",
      keyword: "mushroom",
      kind: "thing",
      at: 2,
      end: 3,
    });
  });

  it("hears animals as creatures, by what they do", () => {
    expect(resolveNature(parsePhrase("a cat"))?.nature).toBe("walker");
    expect(resolveNature(parsePhrase("the white rabbit"))?.nature).toBe("hopper");
    expect(resolveNature(parsePhrase("a bird"))?.nature).toBe("flier");
    expect(resolveNature(parsePhrase("a flying pig"))?.nature).toBe("flier");
    expect(resolveNature(parsePhrase("a hopping dog"))?.nature).toBe("hopper");
  });

  it("hears things with wheels or hulls as vehicles", () => {
    expect(resolveNature(parsePhrase("a car"))?.nature).toBe("vehicle");
    expect(resolveNature(parsePhrase("a little red cart"))?.nature).toBe("vehicle");
    expect(resolveNature(parsePhrase("the boat"))?.nature).toBe("vehicle");
  });

  it("hears plurals", () => {
    expect(resolveNature(parsePhrase("two mushrooms"))?.nature).toBe("bouncy");
    expect(resolveNature(parsePhrase("glasses of water"))?.nature).toBe("shrink");
  });

  it("names every guess chip so that it means what the chip promised", () => {
    for (const { name, nature } of Object.values(CANDIDATES).flat()) {
      expect(resolveNature(parsePhrase(name))?.nature ?? "ink", name).toBe(nature);
    }
  });

  it("gives every creature with a temper by name a creature's nature", () => {
    for (const creature of [...FOLLOWERS, ...FLEERS]) {
      expect(["walker", "hopper", "flier"], creature).toContain(
        resolveNature(parsePhrase(creature))?.nature,
      );
    }
  });

  it.each([
    ["a hot dog", "grow"],
    ["a chicken leg", "grow"],
    ["a jelly bean", "grow"],
    ["a gummy bear", "grow"],
    ["a hot chocolate", "shrink"],
    ["a bubble tea", "shrink"],
    ["an iron ball", "heavy"],
    ["a ball and chain", "heavy"],
    ["a floor lamp", "lantern"],
    ["a traffic light", "lantern"],
    ["a night light", "lantern"],
    ["a paper clip", "sticky"],
    ["a bean bag", "bouncy"],
    ["a teddy bear", "bouncy"],
    ["an aircraft carrier", "vehicle"],
    ["a flying saucer", "floaty"],
  ] as const)("hears %j as one name, not its parts", (name, nature) => {
    expect(resolveNature(parsePhrase(name))?.nature).toBe(nature);
  });

  it("keeps plain the names that only hide a keyword, unless the player says more", () => {
    expect(resolveNature(parsePhrase("a baseball bat"))).toBeNull();
    expect(resolveNature(parsePhrase("a fire hydrant"))).toBeNull();
    expect(resolveNature(parsePhrase("a flying baseball bat"))?.nature).toBe("flier");
  });

  it("knows the rest of Wonderland's cast", () => {
    const cast = [
      "the mad hatter",
      "a dormouse",
      "the duchess",
      "tweedledum",
      "tweedledee",
      "the knave of hearts",
      "humpty dumpty",
      "a unicorn",
      "the bandersnatch",
    ];
    for (const who of cast) expect(resolveNature(parsePhrase(who))?.nature, who).toBe("walker");
    expect(resolveNature(parsePhrase("the jabberwock"))?.nature).toBe("flier");
  });

  it("lets a drink or a cannonball keep a violent word inside its name", () => {
    const rule = (name: string) => ruleOn(name, { allowed: "all", drawingIsDot: false });
    expect(rule("fruit punch").nature).toBe("shrink");
    expect(rule("a cannon ball").nature).toBe("heavy");
    expect(rule("a punch").line).toBe(REFUSALS.weapon);
    expect(rule("a cannon").line).toBe(REFUSALS.weapon);
    expect(rule("fruit punch and a knife").line).toBe(REFUSALS.weapon);
  });
});
