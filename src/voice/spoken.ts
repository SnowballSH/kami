/**
 * Speech carries what writing does not: hesitation ("uh"), politeness ("could you"), and a run-up
 * ("okay so"). None of it is part of the command, and all of it confuses the grammar, so it is
 * taken off before what was said goes into the funnel (`docs/voice.md`).
 */
const HESITATION = /\b(?:u+h+m*|u+m+|m+h+m*|h+m+|e+r+m*|a+h+)\b[\s,.…]*/gi;

const RUN_UP =
  /^(?:[\s,.!?…]*(?:hey|hi|ok|okay|alright|so|well|now|then|yeah|yes|please|can you|could you|would you|i want you to|i'd like you to)\b[\s,.!?…]*)+/i;

const POLITENESS = /[\s,]*\b(?:please|thanks|thank you)\b[\s.!?,]*$/i;

const TIDY = /\s+/g;

export const spoken = (text: string): string =>
  text
    .replace(HESITATION, "")
    .replace(RUN_UP, "")
    .replace(POLITENESS, "")
    .replace(TIDY, " ")
    .replace(/^[\s,.]+/, "")
    .replace(/[\s.!?…]+$/, "")
    .trim();
