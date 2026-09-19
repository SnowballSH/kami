import { tidyName } from "./tidyName";

const KNOWN_NAMES: ReadonlyMap<string, string> = new Map([
  ["birthday cake", "a cake"],
  ["hot air balloon", "a balloon"],
  ["wine bottle", "a bottle"],
  ["wine glass", "a glass"],
  ["coffee cup", "a cup"],
  ["stairs", "stairs"],
]);

const BARE_SHAPES: ReadonlySet<string> = new Set([
  "line",
  "circle",
  "square",
  "triangle",
  "zigzag",
  "squiggle",
  "hexagon",
  "octagon",
]);

const clean = (word: string): string => word.toLowerCase().replace(/\s+/g, " ").trim();

/** Turns Quick, Draw! category words into names the Cat would say; bare shapes name nothing. */
export const namesForRecognized = (words: readonly string[]): readonly string[] =>
  words
    .map(clean)
    .filter((word) => word.length > 0 && !BARE_SHAPES.has(word))
    .map((word) => KNOWN_NAMES.get(word) ?? tidyName(word));
