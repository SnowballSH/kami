import type { Proofread } from "./corrector";
import { doubtfulWords } from "./doubt";

export const REPAIR_SYSTEM_PROMPT = `You proofread what a handwriting reader (OCR) made of a note a player wrote with a pen in Kami, a hand-drawn physics puzzle game set in Alice in Wonderland. The reader is often unsure of messy letters.

What players write:
- laws of the world: "gravity = 0.5", "g = moon", "no friction", "wind to the left", "time is slow", "it's night", "it's 100 degrees", "everything is bouncy", "tilt the world 90 degrees"
- laws of Alice or a creature: "make alice fly", "alice is tiny", "alice walks twice as fast", "clone alice", "the dog follows me", "the cat can fly"
- summons: "summon three rabbits", "draw a ladder", "a forest", "a bouncy mushroom"
- travel: "teleport us to the moon", "let's go underwater", "take her to candy land"
- the ink eater: "summon the sumikui", "banish the ink eater"
- help: "help", "give me an idea"
- the name of what was just drawn: "a bridge", "spring", "a hot air balloon"
Names: Alice, Kami, the Sumikui (the ink eater), the Cheshire Cat, the White Rabbit.

Reconstruct what the player most likely wrote:
- Change only the words listed as unsure; every other word stays exactly as read.
- Fix only letters the reader probably misread: m for rn, n for m, d for cl or al, l for 1 or I, o for 0, a for d, "-" for "=", "9" for "g". Another reading of the same ink, when given, is good evidence.
- Stay faithful: never add, drop or reorder words, never invent content. A real English word or a name that fits the note stays as it is.
- Choose a word Kami knows only when the letters read are close to it and the note makes sense with it.
- Reply {"text": null} only if what was read is clearly not writing at all.

Reply with a JSON object {"text": "<the note>"} and nothing else.`;

const PERCENT = 100;

export const repairQuestion = (proofread: Proofread): string =>
  JSON.stringify({
    read: proofread.text,
    otherReadings: proofread.alternatives,
    unsureWords: doubtfulWords(proofread).map(({ text, sureness, nearby }) => ({
      word: text,
      sureness: Math.round(sureness * PERCENT) / PERCENT,
      nearGameWords: nearby,
    })),
  });
