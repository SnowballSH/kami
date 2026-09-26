/** What a dial reads for "more" and "less" said of it alone: "the rock weighs less". */
export interface Comparatives {
  readonly more: number;
  readonly less: number;
}

/** Halfway from the plain value to the one a quality asks for: "slightly heavier" is 1.5x. */
export const weakened = (value: number, plain: number): number => plain + (value - plain) / 2;

/**
 * "less heavy" is lighter than plain, not heavier: the dial's own "less" (its "more", for "less
 * light"); failing that the reciprocal about its plain value ("spins less fast" is 0.5 turns/s);
 * and for a dial whose plain value is none at all, half the quality ("bounces less").
 */
export const lessened = (value: number, plain: number, compared: Comparatives | null): number => {
  const opposite = value > plain ? compared?.less : value < plain ? compared?.more : undefined;
  if (opposite !== undefined) return opposite;
  return plain !== 0 && value !== 0 ? (plain * plain) / value : weakened(value, plain);
};

/** A reading said with "more" or "less": "more" only says which way, "less" turns it around. */
export const compare = (
  value: number | null,
  plain: number,
  compared: Comparatives | null,
  said: { readonly more: boolean; readonly less: boolean },
): number | null => {
  if (said.less)
    return value === null ? (compared?.less ?? null) : lessened(value, plain, compared);
  if (said.more && value === null) return compared?.more ?? null;
  return value;
};
