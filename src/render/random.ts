export type Random = () => number;

const UINT32_RANGE = 2 ** 32;
const MULBERRY_INCREMENT = 0x6d2b79f5;

export const seededRandom = (seed: number): Random => {
  let state = seed >>> 0;
  return () => {
    state = (state + MULBERRY_INCREMENT) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / UINT32_RANGE;
  };
};

export const between = (random: Random, min: number, max: number): number =>
  min + random() * (max - min);
