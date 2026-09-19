import { vocabulary } from "./vocabulary";

/** What a note says once spelling, punctuation and politeness are out of the way. */
export interface Sentence {
  readonly words: readonly string[];
}

export const METRES_PER_SECOND_SQUARED = "mpss";
export const PERCENT = "percent";

const FILLER = vocabulary(`
  set, sets, make, makes, let, lets, please, the, a, an, be, is, are, am, was, to, equals, equal,
  at, as, of, it, its, this, that, now, just, kami, hey, can, could, would, should, will, shall,
  you, i, we, im, my, our, want, need, like, same, there, here, in, for, by, so, and, then, with,
  feel, feels, act, acts, behave, behaves, work, works, turn, turns, change, changes, switch, put,
  have, has, give, get, gets, become, becomes, do, does, also, too, some, value, amount, level
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

const PHRASES: readonly (readonly [RegExp, string])[] = [
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
];

const rewrite = (text: string, rewrites: readonly (readonly [RegExp, string])[]): string =>
  rewrites.reduce(
    (rewritten, [pattern, replacement]) => rewritten.replace(pattern, replacement),
    text,
  );

const wordsOf = (text: string): readonly string[] =>
  text.split(/\s+/).filter((word) => word.length > 0);

export const normalise = (text: string): Sentence => {
  const meaningful = wordsOf(rewrite(text.toLowerCase(), SYMBOLS)).filter(
    (word) => !FILLER.has(word),
  );
  return { words: wordsOf(rewrite(meaningful.join(" "), PHRASES)) };
};
