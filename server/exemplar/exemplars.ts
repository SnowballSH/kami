import type { Stroke } from "../../src/core/geometry";
import type { NatureTable } from "../natures/natureTable";
import type { SketchLibrary } from "../sketch";

/** A clean drawing of one word, in Quick, Draw!'s 256 px frame with the origin top-left. */
export interface Exemplar {
  readonly word: string;
  readonly strokes: readonly Stroke[];
}

/** Where drawings of a word come from: null when there is no picture of it. */
export interface ExemplarSource {
  /** Every Quick, Draw! category there is a picture of; what the game builds its summoning lexicon from. */
  readonly categories: readonly string[];
  exemplar(word: string): Promise<Exemplar | null>;
}

const ARTICLES = new Set(["a", "an", "the", "some", "one", "my", "your", "our"]);

const wordsOf = (text: string): readonly string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((word) => word.length > 0);

const singular = (word: string): string => {
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (/(ss|us)$/.test(word)) return word;
  if (/(ch|sh|x|z|s)es$/.test(word)) return word.slice(0, -2);
  return word.endsWith("s") ? word.slice(0, -1) : word;
};

const phrasings = (text: string): readonly string[] => {
  const words = wordsOf(text).filter((word) => !ARTICLES.has(word));
  if (words.length === 0) return [];
  const asSaid = words.join(" ");
  const oneOf = [...words.slice(0, -1), singular(words.at(-1) ?? "")].join(" ");
  return asSaid === oneOf ? [asSaid] : [asSaid, oneOf];
};

const bareNameOf = (name: string): string =>
  wordsOf(name)
    .filter((word) => !ARTICLES.has(word))
    .join(" ");

/** The Quick, Draw! category a spoken word stands for: "rabbits" → rabbit, "the hot air balloon" → hot air balloon. */
export const categoryOf = (word: string, natures: NatureTable): string | null => {
  const known = new Set(natures.categories);
  const byName = new Map(
    natures.categories.map((category) => [bareNameOf(natures.describe(category).name), category]),
  );
  for (const phrasing of phrasings(word)) {
    if (known.has(phrasing)) return phrasing;
    const named = byName.get(phrasing);
    if (named !== undefined) return named;
  }
  return null;
};

export const createExemplarSource = (
  sketches: SketchLibrary,
  natures: NatureTable,
): ExemplarSource => ({
  categories: sketches.categories,
  exemplar: async (word) => {
    const category = categoryOf(word, natures);
    if (category === null) return null;
    const sketch = await sketches.pick(category);
    return sketch === null ? null : { word: category, strokes: sketch.strokes };
  },
});
