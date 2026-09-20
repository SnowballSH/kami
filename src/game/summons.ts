import { boundsOf, type Rect, rectsOverlap, type Stroke, type Vec } from "../core/geometry";

/**
 * "summon a rabbit", "kami, draw me a bridge here", "conjure up two clouds" → what to draw. Null
 * for anything that is not asking Kami to draw. Words for the Sumikui never summon a picture:
 * they are a law, and the compiler hears them first.
 */
const SUMMONS =
  /^(?:(?:hey|oh|dear|please|ok|okay)[\s,]+)?(?:kami[\s,]+)?(?:please[\s,]+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:summon|conjure|draw|sketch|spawn|doodle|manifest)(?:\s+up)?(?:\s+(?:me|us|him|her|alice))?\s+(?<what>.+?)\s*$/i;
const TRAILING =
  /\s+(?:right\s+)?(?:here|there|now|please|for\s+(?:me|us|her|alice)|next\s+to\s+(?:her|alice)|beside\s+(?:her|alice)|by\s+(?:her|alice)|over\s+here|in\s+front\s+of\s+(?:her|alice))\s*$/i;

const trailingWordsOff = (phrase: string): string => {
  let bare = phrase;
  for (;;) {
    const shorter = bare.replace(TRAILING, "").replace(/[,;:.!?]+$/, "");
    if (shorter === bare) return bare;
    bare = shorter;
  }
};

export const summonsOf = (text: string): string | null => {
  const asked = SUMMONS.exec(text.trim().replace(/[.!?]+$/, ""));
  if (asked?.groups?.what === undefined) return null;
  const what = trailingWordsOff(asked.groups.what).trim();
  return what.length === 0 || /\b(?:ink\s*eater|sumikui|bokushoku)\b/i.test(what) ? null : what;
};

/** The longer side of what Kami draws, in world px: a little taller than Alice. */
export const SUMMONED_SIZE = 110;
const ABOVE_WRITING = 14;

/**
 * Where a summoned drawing lands: fitted to `SUMMONED_SIZE`, centred over the words that asked for
 * it and standing just above them, lifted clear of Alice when she is in the way.
 */
export const placeSummoned = (
  strokes: readonly Stroke[],
  writing: Rect,
  alice: Rect | null,
): readonly Stroke[] => {
  const frame = boundsOf(strokes.flat());
  const scale = SUMMONED_SIZE / Math.max(frame.width, frame.height, 1);
  const width = frame.width * scale;
  const height = frame.height * scale;
  const left = writing.x + writing.width / 2 - width / 2;
  const overWords = writing.y - ABOVE_WRITING - height;
  const inAlicesWay =
    alice !== null && rectsOverlap({ x: left, y: overWords, width, height }, alice);
  const top = inAlicesWay ? alice.y - ABOVE_WRITING - height : overWords;
  const origin: Vec = { x: left - frame.x * scale, y: top - frame.y * scale };
  return strokes.map((stroke) =>
    stroke.map(({ x, y }) => ({ x: origin.x + x * scale, y: origin.y + y * scale })),
  );
};
