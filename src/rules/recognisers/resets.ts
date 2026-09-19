import { earthRule } from "../effects";
import type { Recogniser } from "../recogniser";
import { ALICE, GOVERNS, SUBJECTS } from "../subjects";
import { mentions, SCOPE, union, vocabulary } from "../vocabulary";

const RESETS = vocabulary(`
  normal, normally, reset, resets, default, regular, standard, usual, restore, restored, ordinary,
  original, back, again, on, realtime, undo
`);
const HOME = vocabulary("earth, earths, earthlike");

const KNOWN = union(RESETS, HOME, SCOPE, ALICE, ...Object.values(SUBJECTS));

export const recogniseReset: Recogniser = ({ words }) => {
  if (!words.every((word) => KNOWN.has(word)) || !mentions(words, RESETS)) return null;
  const [governs, ...others] = GOVERNS.filter((candidate) => mentions(words, SUBJECTS[candidate]));
  if (others.length > 0) return null;
  if (governs !== undefined) return earthRule(governs);
  return mentions(words, HOME) ? earthRule("gravity") : null;
};
