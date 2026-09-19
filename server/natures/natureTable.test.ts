// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NATURES, STRENGTH_RANGE } from "../../src/cat/types";
import {
  createNatureTable,
  MAX_LINE_WORDS,
  type NatureEntry,
  natureTableSchema,
  quickdrawNatureTable,
  wordCount,
} from "./natureTable";

const QUICKDRAW_CATEGORY_COUNT = 345;
const MOST_PLAIN_INK_SHARE = 0.5;
const TOP_LEVEL_KEY = /^ {2}"([^"]+)": \{/gm;

const readBeside = (file: string): string =>
  readFileSync(new URL(`./${file}`, import.meta.url), "utf8");

const officialCategories = readBeside("quickdrawCategories.txt")
  .split("\n")
  .filter((category) => category.length > 0);

const rawTable = readBeside("quickdrawNatures.json");
const entries: Readonly<Record<string, NatureEntry>> = natureTableSchema.parse(
  JSON.parse(rawTable),
);

const entry = (overrides: Partial<NatureEntry> = {}): NatureEntry => ({
  name: "a thing",
  nature: "ink",
  strength: 1,
  line: "How curious.",
  ...overrides,
});

describe("the reviewed Quick, Draw! table", () => {
  it("names every official category exactly once, spelt as Google spells it", () => {
    const written = [...rawTable.matchAll(TOP_LEVEL_KEY)].map(([, category]) => category);
    expect(officialCategories).toHaveLength(QUICKDRAW_CATEGORY_COUNT);
    expect(written.toSorted()).toEqual(officialCategories.toSorted());
    expect(quickdrawNatureTable.categories.toSorted()).toEqual(officialCategories.toSorted());
  });

  it("gives each a known nature, a strength in range and a line Kami has time to write", () => {
    for (const [category, { name, nature, strength, line }] of Object.entries(entries)) {
      expect(name.length, category).toBeGreaterThan(0);
      expect(NATURES, category).toContain(nature);
      expect(strength, category).toBeGreaterThanOrEqual(STRENGTH_RANGE.min);
      expect(strength, category).toBeLessThanOrEqual(STRENGTH_RANGE.max);
      expect(wordCount(line), category).toBeGreaterThan(0);
      expect(wordCount(line), category).toBeLessThanOrEqual(MAX_LINE_WORDS);
    }
  });

  it("points aliases at real categories of the same nature, never at another alias", () => {
    const aliased = Object.entries(entries).filter(([, { alias }]) => alias !== undefined);
    expect(aliased.length).toBeGreaterThan(0);
    for (const [category, { alias, nature }] of aliased) {
      const target = entries[alias ?? ""];
      expect(target, category).toBeDefined();
      expect(target?.alias, category).toBeUndefined();
      expect(target?.nature, category).toBe(nature);
    }
  });

  it("leaves well under half of the world as plain ink", () => {
    const plain = Object.values(entries).filter(({ nature }) => nature === "ink");
    expect(plain.length / officialCategories.length).toBeLessThan(MOST_PLAIN_INK_SHARE);
  });
});

describe("describe", () => {
  it("speaks of a category as Kami would write it", () => {
    expect(quickdrawNatureTable.describe("mushroom")).toMatchObject({
      name: "a mushroom",
      nature: "bouncy",
    });
    expect(quickdrawNatureTable.describe("The Eiffel Tower").name).toBe("The Eiffel Tower");
    expect(quickdrawNatureTable.describe("stairs").name).toBe("stairs");
  });

  it("describes an alias as the thing it stands for", () => {
    expect(quickdrawNatureTable.canonical("birthday cake")).toBe("cake");
    expect(quickdrawNatureTable.describe("birthday cake")).toEqual(
      quickdrawNatureTable.describe("cake"),
    );
  });

  it("calls anything it has never met plain ink", () => {
    expect(quickdrawNatureTable.describe("umbrella stand")).toMatchObject({
      name: "an umbrella stand",
      nature: "ink",
      strength: 1,
    });
  });
});

describe("merge", () => {
  it("sums what aliases saw and sorts again, best first", () => {
    const merged = quickdrawNatureTable.merge([
      { category: "mushroom", confidence: 0.4 },
      { category: "birthday cake", confidence: 0.3 },
      { category: "cake", confidence: 0.25 },
      { category: "never heard of it", confidence: 0.05 },
    ]);
    expect(merged.map(({ category }) => category)).toEqual([
      "cake",
      "mushroom",
      "never heard of it",
    ]);
    expect(merged[0]?.confidence).toBeCloseTo(0.55);
  });
});

describe("start-up validation", () => {
  it.each([
    ["an unknown nature", { thing: { ...entry(), nature: "sparkly" } }],
    ["a strength out of range", { thing: entry({ strength: 3 }) }],
    ["a line too long to write", { thing: entry({ line: "word ".repeat(MAX_LINE_WORDS + 1) }) }],
    ["an alias to nothing", { thing: entry({ alias: "nothing" }) }],
    ["a chain of aliases", { a: entry({ alias: "b" }), b: entry({ alias: "c" }), c: entry() }],
  ])("refuses %s", (_what, source) => {
    expect(() => createNatureTable(source)).toThrow();
  });
});
