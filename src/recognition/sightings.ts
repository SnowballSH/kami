import { NATURES, type Nature } from "../cat/types";
import type { Sighting } from "./types";

const isListOf =
  <Item>(isItem: (item: unknown) => item is Item) =>
  (value: unknown): value is readonly Item[] =>
    Array.isArray(value) && value.every(isItem);

const isWord = (item: unknown): item is string => typeof item === "string";
const isNumber = (item: unknown): item is number =>
  typeof item === "number" && Number.isFinite(item);
const isNature = (item: unknown): item is Nature => NATURES.some((nature) => nature === item);

const isWords = isListOf(isWord);
const isNumbers = isListOf(isNumber);
const isNatures = isListOf(isNature);

/** The server's parallel arrays as one list; [] for anything that is not the documented shape. */
export const sightingsOf = (body: unknown): readonly Sighting[] => {
  if (typeof body !== "object" || body === null) return [];
  const { guesses, confidence, names, natures, strengths, lines } = body as Record<string, unknown>;
  if (!isWords(guesses) || !isNumbers(confidence) || !isWords(names)) return [];
  if (!isNatures(natures) || !isNumbers(strengths) || !isWords(lines)) return [];
  const columns = [confidence, names, natures, strengths, lines];
  if (columns.some((column) => column.length !== guesses.length)) return [];
  return guesses.map((word, index) => ({
    word,
    confidence: confidence[index] ?? 0,
    name: names[index] ?? word,
    nature: natures[index] ?? "ink",
    strength: strengths[index] ?? 1,
    line: lines[index] ?? "",
  }));
};
