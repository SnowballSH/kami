import type { Tag } from "./lexicon";
import type { Nature } from "./types";

export type LineSet = readonly [string, ...string[]];

export const ASK_WHAT_IT_IS = "And what is that supposed to be?";
export const OFFER_HELP = "Ask, if you like.";

export const REFUSALS = {
  key: "A lovely picture of a key.",
  alice: "She isn't yours to rewrite. Only what you draw.",
  weapon: "He's only cardboard. Be kind.",
  room: "I didn't draw it. Neither did you.",
  forbidden: "None of that down here. It's only ink.",
} as const;

export const NEAR_ENOUGH = "Near enough. Up it goes.";

export const forbiddenThingLine = (thing: string): string =>
  `No ${thing} down here. It's only ink.`;

export const smallestThingLine = (thing: string): string => `The smallest ${thing} I ever saw.`;

export const ACCEPTANCE: Readonly<Record<Nature, LineSet>> = {
  ink: [
    "If you say so. It's ink to me.",
    "How curious. It will hold her weight, at least.",
    "Whatever it is, it's solid. That's something.",
  ],
  bouncy: [
    "If you say so. Mind her head on the way up.",
    "Springy. Do look before she leaps.",
    "What goes down must come up, apparently.",
  ],
  climbable: [
    "Rung by rung, then. I prefer to simply appear.",
    "Up and down, like a good argument.",
    "A way up. Or a way down, depending where you begin.",
  ],
  floaty: [
    "Up it goes. Most things do, if you let go.",
    "Lighter than a thought. Do hold on.",
    "It rises. Whether she rises with it is another matter.",
  ],
  heavy: [
    "Heavy as a Monday. Mind her toes.",
    "It will stay where it lands, that one.",
    "Weighty. Gravity sends its regards.",
  ],
  light: [
    "Light as a rumour. A sneeze would move it.",
    "Barely there. Rather like me.",
    "It weighs less than its own name.",
  ],
  slippery: [
    "Slippery. Dignity is not guaranteed.",
    "Smooth as an excuse. Watch her go.",
    "Nothing to hold on to. How freeing.",
  ],
  sticky: [
    "It will stay put. Stubborn, like the Duchess.",
    "Stuck fast. Wherever it lands, it lives.",
    "Sticky. Try not to become attached.",
  ],
  grow: [
    "Eat me, it says. She usually does.",
    "One bite and the ceiling gets closer.",
    "A little something to grow on.",
  ],
  shrink: [
    "Drink me. She'll shut up like a telescope.",
    "One sip, and the world gets roomier.",
    "Small is only a matter of where you stand.",
  ],
};

export const TAG_LINES: Readonly<Record<Tag, string>> = {
  rose: "Mind the Queen doesn't catch it that colour.",
  tart: "Somebody will steal that. Somebody always does.",
  queen: "Careful. She takes heads off for less.",
};

const HASH_SEED = 7;
const HASH_FACTOR = 31;

const hashOf = (text: string): number =>
  [...text].reduce(
    (hash, char) => (hash * HASH_FACTOR + (char.codePointAt(0) ?? 0)) >>> 0,
    HASH_SEED,
  );

export const pickLine = (lines: LineSet, seed: string): string =>
  lines[hashOf(seed) % lines.length] ?? lines[0];
