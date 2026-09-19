import { readAmount } from "../amounts";
import { scalarRule } from "../effects";
import { knownWords, type Recogniser, understands } from "../recogniser";
import { SUBJECTS } from "../subjects";
import { INTENSIFIERS, mentions, vocabulary } from "../vocabulary";

const THICK_AIR = 4;
const THIN_AIR = 0.25;

const NAMED_AIRS: ReadonlyMap<string, number> = new Map([
  ["vacuum", 0],
  ["airless", 0],
  ["underwater", 6],
]);
const AIR_NAMES = new Set(NAMED_AIRS.keys());
const THICK = vocabulary("thick, thicker, dense, heavy, soupy, syrupy, more, high, strong, lots");
const THIN = vocabulary("thin, thinner, light, less, low, little");

const KNOWN = knownWords(SUBJECTS.airDrag, AIR_NAMES, THICK, THIN, INTENSIFIERS);

const readStatedDrag = (words: readonly string[]): number | null => {
  const amount = readAmount(words);
  if (amount !== null)
    return amount.unit === "plain" || amount.unit === "multiple" ? amount.value : null;
  if (mentions(words, THICK)) return THICK_AIR;
  return mentions(words, THIN) ? THIN_AIR : null;
};

export const recogniseAir: Recogniser = ({ words }) => {
  if (!understands(words, KNOWN)) return null;
  const named = words.map((word) => NAMED_AIRS.get(word)).find((drag) => drag !== undefined);
  const drag = named ?? (mentions(words, SUBJECTS.airDrag) ? readStatedDrag(words) : null);
  return drag === null ? null : scalarRule("airDrag", drag);
};
