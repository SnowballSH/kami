import { refersBack } from "./referents";
import type { CompileContext } from "./types";
import { vocabulary } from "./vocabulary";

/**
 * What a note says once spelling, punctuation and politeness are out of the way. `subjects` are
 * the words the player pointed at with a determiner ("the wheel", "every cloud"), in order;
 * `referent` is what its pronoun stands for ("it spins" beside a boat), when it has one.
 */
export interface Sentence {
  readonly words: readonly string[];
  readonly subjects: readonly string[];
  readonly referent: string | null;
}

export const METRES_PER_SECOND_SQUARED = "mpss";
export const PERCENT = "percent";

const FILLER = vocabulary(`
  set, sets, make, makes, let, lets, please, the, a, an, be, is, are, am, was, to, equals, equal,
  at, as, of, it, its, this, that, now, just, kami, hey, can, could, would, should, will, shall,
  you, i, we, im, my, our, want, need, like, same, there, here, in, for, by, so, and, then, with,
  feel, feels, act, acts, behave, behaves, work, works, turn, turns, change, changes, switch, put,
  have, has, give, get, gets, become, becomes, do, does, also, too, some, value, amount, level,
  itself, these, those, they, them, their, themselves
`);

const SYMBOLS: readonly (readonly [RegExp, string])[] = [
  [/[’‘`]/g, "'"],
  [/'s\b/g, ""],
  [/'/g, ""],
  [/²/g, "^2"],
  [/×/g, " x "],
  [/½/g, " 1/2 "],
  [/¼/g, " 1/4 "],
  [/¾/g, " 3/4 "],
  [
    /(?<![a-z])m(?:et(?:er|re)s?)?\s*(?:\/|per)\s*s(?:ec(?:ond)?s?)?\s*(?:\^\s*2|\*\*\s*2|2|squared|(?:\/|per)\s*s(?:ec(?:ond)?s?)?)?(?![a-z])/g,
    ` ${METRES_PER_SECOND_SQUARED} `,
  ],
  [/(?<![a-z])m\s*s\s*\^\s*-\s*2/g, ` ${METRES_PER_SECOND_SQUARED} `],
  [/%/g, ` ${PERCENT} `],
  [/(?<=\d)(?=[a-z])|(?<=[a-z])(?=\d)/g, " "],
  [/[^a-z0-9./\s-]/g, " "],
  [/\.(?!\d)/g, " "],
  [/(?<!\d)\/|\/(?!\d)/g, " "],
  [/-(?![\d.])|(?<=[a-z0-9.])-/g, " "],
];

const DETERMINERS = vocabulary("the, this, that, these, those, every, each, all, my, our, your");

const NAMED_ALICE: readonly (readonly [RegExp, string])[] = [
  [/\b(?:the|this|our|my) (?:girl|character|player|hero|heroine|protagonist)\b/g, "alice"],
];

const POINTING: readonly (readonly [RegExp, string])[] = [[/\b(?:this|that) one\b/g, "it"]];

const PHRASES: readonly (readonly [RegExp, string])[] = [
  [/\bno longer\b|\bany longer$|\bno more$/g, "anymore"],
  [/\bupside down\b/g, "flipped"],
  [/\banti gravity\b/g, "antigravity"],
  [/\bslow mo(?:tion)?\b/g, "slowmo"],
  [/\bfast (?:forward|motion)\b/g, "fastforward"],
  [/\bbullet time\b/g, "bullettime"],
  [/\breal time\b/g, "realtime"],
  [/\btime scale\b/g, "timescale"],
  [/\bair (?:resistance|drag|friction)\b/g, "airdrag"],
  [/\bwind (?:speed|strength|force)\b/g, "wind"],
  [/\bblack hole\b/g, "blackhole"],
  [/\bink ?(?:eater|eaters|devourer|monster)\b/g, "inkeater"],
  [/\bsumi ?kui\b/g, "sumikui"],
];

const rewrite = (text: string, rewrites: readonly (readonly [RegExp, string])[]): string =>
  rewrites.reduce(
    (rewritten, [pattern, replacement]) => rewritten.replace(pattern, replacement),
    text,
  );

const wordsOf = (text: string): readonly string[] =>
  text.split(/\s+/).filter((word) => word.length > 0);

const pointedAt = (words: readonly string[]): readonly string[] =>
  words.flatMap((word, at) => {
    const next = words[at + 1];
    return DETERMINERS.has(word) && next !== undefined && !FILLER.has(next) ? [next] : [];
  });

export const normalise = (text: string, context?: CompileContext): Sentence => {
  const spoken = wordsOf(
    rewrite(rewrite(rewrite(text.toLowerCase(), SYMBOLS), NAMED_ALICE), POINTING),
  );
  const meaningful = spoken.filter((word) => !FILLER.has(word));
  return {
    words: wordsOf(rewrite(meaningful.join(" "), PHRASES)),
    subjects: pointedAt(spoken),
    referent: context !== undefined && refersBack(spoken) ? context.referent : null,
  };
};
