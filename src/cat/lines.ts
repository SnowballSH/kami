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
  solid: [
    "Solid as a fact. It shan't budge for anyone.",
    "It will stay exactly there. How unlike me.",
    "Something to stand on. Opinions rarely manage that.",
  ],
  walker: [
    "It walks. Not everything that walks knows where to.",
    "Off it goes, up and down. Company for her, at least.",
    "Alive, then. Do mind it doesn't wander off the edge.",
  ],
  hopper: [
    "Hop, hop. It will not stay where you put it.",
    "Late for something, I expect. They always are.",
    "It leaps. She may leap after it, if she likes.",
  ],
  flier: [
    "Wings. It won't go far, but it won't come down either.",
    "Up it flaps. Stand on it if you dare.",
    "A flier. It keeps to its patch of sky.",
  ],
  goal: [
    "So that's where she's going. I did wonder.",
    "An ending! Now all she needs is a middle.",
    "Any road gets her there, if that's where it ends.",
  ],
  hazard: [
    "Nasty. One touch and she begins again.",
    "Do mind it. It certainly won't mind her.",
    "A little danger keeps the walking interesting.",
  ],
  spawn: [
    "Begin at the beginning, then. This is it.",
    "So this is where she begins. Again and again, I expect.",
    "A place to come back to. Everyone should have one.",
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
