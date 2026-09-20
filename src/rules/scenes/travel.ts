const HAIL = String.raw`(?:(?:hey|oh|dear|please|ok|okay)[\s,]+)?(?:kami[\s,]+)?(?:please[\s,]+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?`;

const TRAVELLERS = String.raw`(?:us|me|alice|her|everyone|everybody|them|all\s+of\s+us|us\s+all)`;

const CARRY = String.raw`(?:teleport|take|bring|send|beam|whisk|transport|warp|fly|carry|zap|drop|put|move|get)\s+${TRAVELLERS}\s+(?:all\s+)?`;

const TOGETHER = String.raw`(?:let'?s|let\s+us|we|we'?re|we\s+are|shall\s+we)\s+(?:all\s+)?(?:go|going|travel|head|heading|move|fly|flying|journey)\s+`;

const ALONE = String.raw`(?:go|travel|journey|head|visit|enter|off)\s+`;

const ANNOUNCE = String.raw`(?:next\s+stop|destination|welcome)[\s,:]+`;

const TRAVEL = new RegExp(
  String.raw`^${HAIL}(?:${CARRY}|${TOGETHER}|${ALONE}|${ANNOUNCE})(?:back\s+)?(?:(?:to|into|onto|under|in|on|at|towards?|for)\s+)?(?<where>.+?)\s*$`,
  "i",
);

const TRAILING = /\s+(?:please|now|right\s+now|already|next|again|together|instead)\s*$/i;

const ARTICLE = /^(?:the|a|an|some|our|my|your)\s+/i;

const trailingWordsOff = (words: string): string => {
  let bare = words.replace(/[,;:.!?]+$/, "");
  for (;;) {
    const shorter = bare.replace(TRAILING, "").replace(/[,;:.!?]+$/, "");
    if (shorter === bare) return bare;
    bare = shorter;
  }
};

/**
 * Where the words ask to go — "teleport us to the moon", "let's go underwater", "take her to
 * candy land" — as a lowercase place with its article dropped; null when nobody asked to travel.
 */
export const destinationOf = (text: string): string | null => {
  const asked = TRAVEL.exec(text.trim().replace(/[.!?]+$/, ""));
  if (asked?.groups?.where === undefined) return null;
  const where = trailingWordsOff(asked.groups.where)
    .replace(ARTICLE, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return where.length === 0 ? null : where;
};
