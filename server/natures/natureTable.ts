/** Kami's reviewed table from Quick, Draw! categories to display names, physics natures and his reactions. */
import { z } from "zod";
import { NATURES, type Nature, STRENGTH_RANGE } from "../../src/cat/types";
import type { RankedCategory } from "../quickdraw/recognizer";
import quickdrawNatures from "./quickdrawNatures.json";

export const MAX_LINE_WORDS = 12;

const UNKNOWN_NATURE: Nature = "ink";
const UNKNOWN_STRENGTH = 1;
const UNKNOWN_LINE = "How curious. It's ink to me.";
const UNNAMED = "a scribble";
const VOWEL_START = /^[aeiou]/i;

export const wordCount = (line: string): number =>
  line.split(/\s+/).filter((word) => word.length > 0).length;

const entrySchema = z.strictObject({
  name: z.string().trim().min(1),
  nature: z.enum(NATURES),
  strength: z.number().min(STRENGTH_RANGE.min).max(STRENGTH_RANGE.max),
  alias: z.string().min(1).exactOptional(),
  line: z
    .string()
    .trim()
    .min(1)
    .refine((line) => wordCount(line) <= MAX_LINE_WORDS, `at most ${MAX_LINE_WORDS} words`),
});

export type NatureEntry = z.infer<typeof entrySchema>;

const aliasProblem = (
  table: Readonly<Record<string, NatureEntry>>,
  category: string,
  alias: string,
): string | null => {
  const target = table[alias];
  if (alias === category || target === undefined) return `"${alias}" is not another category`;
  return target.alias === undefined ? null : `"${alias}" is itself an alias; aliases never chain`;
};

export const natureTableSchema = z.record(z.string(), entrySchema).superRefine((table, context) => {
  for (const [category, { alias }] of Object.entries(table)) {
    const problem = alias === undefined ? null : aliasProblem(table, category, alias);
    if (problem !== null) {
      context.addIssue({ code: "custom", path: [category, "alias"], message: problem });
    }
  }
});

export interface NatureDescription {
  readonly name: string;
  readonly nature: Nature;
  readonly strength: number;
  readonly line: string;
}

export interface NatureTable {
  readonly categories: readonly string[];
  /** The category an alias stands for; any other word is its own canonical form. */
  canonical(category: string): string;
  /** Never rejects: a category the table has not met is plain ink. */
  describe(category: string): NatureDescription;
  /** Folds aliased categories together by summing their confidence, best first. */
  merge(ranked: readonly RankedCategory[]): readonly RankedCategory[];
}

const withArticle = (word: string): string =>
  word.length === 0 ? UNNAMED : `${VOWEL_START.test(word) ? "an" : "a"} ${word}`;

const describeUnknown = (category: string): NatureDescription => ({
  name: withArticle(category.trim().toLowerCase()),
  nature: UNKNOWN_NATURE,
  strength: UNKNOWN_STRENGTH,
  line: UNKNOWN_LINE,
});

export const createNatureTable = (source: unknown): NatureTable => {
  const entries = new Map(Object.entries(natureTableSchema.parse(source)));
  const canonical = (category: string): string => entries.get(category)?.alias ?? category;

  return {
    categories: [...entries.keys()],
    canonical,
    describe: (category) => {
      const entry = entries.get(canonical(category));
      if (entry === undefined) return describeUnknown(category);
      const { name, nature, strength, line } = entry;
      return { name, nature, strength, line };
    },
    merge: (ranked) => {
      const totals = new Map<string, number>();
      for (const { category, confidence } of ranked) {
        const key = canonical(category);
        totals.set(key, (totals.get(key) ?? 0) + confidence);
      }
      return [...totals]
        .map(([category, confidence]) => ({ category, confidence }))
        .sort((a, b) => b.confidence - a.confidence);
    },
  };
};

export const quickdrawNatureTable: NatureTable = createNatureTable(quickdrawNatures);
