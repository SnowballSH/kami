import type { Summons } from "./types";

const LONGEST_NAME_IN_WORDS = 5;

const IRREGULAR_PLURALS: Readonly<Record<string, string>> = {
  mouse: "mice",
  foot: "feet",
  tooth: "teeth",
  cactus: "cacti",
  octopus: "octopi",
  fish: "fish",
  sheep: "sheep",
  moose: "moose",
  leaf: "leaves",
  knife: "knives",
  wolf: "wolves",
  child: "children",
  person: "people",
};

/**
 * A word for several things at once. Each stands for a handful of categories; whichever the
 * library lacks are left out, and a scene the library cannot draw at all is not a word.
 */
const SCENES: Readonly<Record<string, readonly Summons[]>> = {
  forest: [
    { category: "tree", count: 3 },
    { category: "bush", count: 1 },
  ],
  woods: [
    { category: "tree", count: 3 },
    { category: "mushroom", count: 1 },
  ],
  jungle: [
    { category: "palm tree", count: 2 },
    { category: "tree", count: 1 },
    { category: "monkey", count: 1 },
  ],
  orchard: [
    { category: "tree", count: 2 },
    { category: "apple", count: 2 },
  ],
  meadow: [
    { category: "grass", count: 2 },
    { category: "flower", count: 2 },
  ],
  city: [
    { category: "skyscraper", count: 2 },
    { category: "house", count: 1 },
    { category: "streetlight", count: 1 },
  ],
  town: [
    { category: "house", count: 2 },
    { category: "church", count: 1 },
    { category: "tree", count: 1 },
  ],
  village: [
    { category: "house", count: 2 },
    { category: "windmill", count: 1 },
    { category: "fence", count: 1 },
  ],
  farm: [
    { category: "barn", count: 1 },
    { category: "cow", count: 1 },
    { category: "pig", count: 1 },
    { category: "fence", count: 1 },
  ],
  zoo: [
    { category: "lion", count: 1 },
    { category: "giraffe", count: 1 },
    { category: "elephant", count: 1 },
    { category: "fence", count: 1 },
  ],
  sky: [
    { category: "cloud", count: 2 },
    { category: "sun", count: 1 },
  ],
  storm: [
    { category: "cloud", count: 2 },
    { category: "lightning", count: 1 },
    { category: "rain", count: 1 },
  ],
  seaside: [
    { category: "sailboat", count: 1 },
    { category: "palm tree", count: 1 },
    { category: "sun", count: 1 },
  ],
  sea: [
    { category: "sailboat", count: 1 },
    { category: "whale", count: 1 },
  ],
  camp: [
    { category: "tent", count: 1 },
    { category: "campfire", count: 1 },
    { category: "tree", count: 1 },
  ],
  campsite: [
    { category: "tent", count: 1 },
    { category: "campfire", count: 1 },
    { category: "tree", count: 1 },
  ],
  party: [
    { category: "birthday cake", count: 1 },
    { category: "candle", count: 2 },
    { category: "lollipop", count: 1 },
  ],
  picnic: [
    { category: "sandwich", count: 1 },
    { category: "apple", count: 1 },
    { category: "basket", count: 1 },
  ],
  kitchen: [
    { category: "stove", count: 1 },
    { category: "frying pan", count: 1 },
    { category: "teapot", count: 1 },
  ],
  bedroom: [
    { category: "bed", count: 1 },
    { category: "floor lamp", count: 1 },
    { category: "pillow", count: 1 },
  ],
  playground: [
    { category: "swing set", count: 1 },
    { category: "see saw", count: 1 },
    { category: "tree", count: 1 },
  ],
  band: [
    { category: "guitar", count: 1 },
    { category: "drums", count: 1 },
    { category: "trumpet", count: 1 },
  ],
  breakfast: [
    { category: "bread", count: 1 },
    { category: "coffee cup", count: 1 },
    { category: "banana", count: 1 },
  ],
};

export const pluralOf = (word: string): string => {
  const irregular = IRREGULAR_PLURALS[word];
  if (irregular !== undefined) return irregular;
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  if (word.endsWith("fe")) return `${word.slice(0, -2)}ves`;
  if (word.endsWith("f")) return `${word.slice(0, -1)}ves`;
  return `${word}s`;
};

export const wordsOf = (text: string): readonly string[] =>
  text
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .replace(/[^a-z0-9,&\s]+/g, "")
    .replace(/,/g, " , ")
    .replace(/&/g, " & ")
    .split(/\s+/)
    .filter((word) => word.length > 0);

interface Name {
  readonly words: string;
  readonly plural: boolean;
}

const namesOf = (category: string): readonly Name[] => {
  const words = wordsOf(category).filter((word) => word !== "the");
  const last = words.at(-1);
  if (last === undefined) return [];
  const plural = [...words.slice(0, -1), pluralOf(last)];
  const names = [
    { words: words.join(" "), plural: false },
    { words: plural.join(" "), plural: true },
  ];
  if (words.length > 1) {
    names.push({ words: words.join(""), plural: false }, { words: plural.join(""), plural: true });
  }
  return names;
};

export interface Thing {
  readonly summons: readonly Summons[];
  /** The name was a plural ("rabbits") or a scene: more than one is meant. */
  readonly several: boolean;
}

export interface Found extends Thing {
  /** How many words the name took. */
  readonly length: number;
}

/**
 * What can be summoned, by every name the player might write it under: each category singular
 * and plural ("rabbit", "rabbits", "hot air balloons", "teddy bear"), and the scene words.
 */
export class SummoningLexicon {
  private readonly things = new Map<string, Thing>();

  constructor(categories: readonly string[]) {
    const known = new Set(categories);
    for (const category of categories) {
      for (const { words, plural } of namesOf(category)) {
        this.things.set(words, { summons: [{ category, count: 1 }], several: plural });
      }
    }
    for (const [scene, parts] of Object.entries(SCENES)) {
      const summons = parts.filter(({ category }) => known.has(category));
      if (summons.length > 0 && !this.things.has(scene)) {
        this.things.set(scene, { summons, several: true });
      }
    }
  }

  get isEmpty(): boolean {
    return this.things.size === 0;
  }

  /** The longest name that starts at `from`, and what it summons; null when none does. */
  lookUp(words: readonly string[], from: number): Found | null {
    const longest = Math.min(LONGEST_NAME_IN_WORDS, words.length - from);
    for (let length = longest; length >= 1; length--) {
      const thing = this.things.get(words.slice(from, from + length).join(" "));
      if (thing !== undefined) return { ...thing, length };
    }
    return null;
  }
}
