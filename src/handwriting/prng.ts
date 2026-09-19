const UINT32_RANGE = 2 ** 32;
const MULBERRY_INCREMENT = 0x6d2b79f5;

const toUint32 = (seed: number): number => {
  if (!Number.isFinite(seed)) return 0;
  const whole = Math.floor(seed);
  const fraction = seed - whole;
  return (whole ^ Math.floor(fraction * UINT32_RANGE)) >>> 0;
};

/** mulberry32: tiny, fast, and the same sequence for the same seed on every machine. */
export class SeededRandom {
  #state: number;

  constructor(seed: number) {
    this.#state = toUint32(seed);
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.#state = (this.#state + MULBERRY_INCREMENT) >>> 0;
    let mixed = this.#state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / UINT32_RANGE;
  }

  between(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform in [-amplitude, amplitude). */
  around(amplitude: number): number {
    return this.between(-amplitude, amplitude);
  }
}
