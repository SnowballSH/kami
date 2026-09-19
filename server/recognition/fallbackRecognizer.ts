/**
 * Asks the primary recogniser and, whenever it has no answer, the floor — so the caller always gets
 * a reading, certainty floor included, from whichever of the two answered. A circuit breaker keeps a
 * dead primary from costing a timeout on every sketch.
 */
import type { Stroke } from "../../src/core/geometry";
import { CircuitBreaker, type CircuitBreakerOptions, type Clock } from "./circuitBreaker";
import type { RankOptions, Reading, SketchRanker, UnreliableSketchRanker } from "./types";

export type RecognizerSource = "primary" | "floor";

export interface SourcedReading {
  readonly source: RecognizerSource;
  readonly reading: Reading;
}

export interface FallbackSettings {
  readonly breaker: CircuitBreakerOptions;
  readonly now: Clock;
  readonly onPrimaryAvailabilityChange: (available: boolean) => void;
}

export const DEFAULT_BREAKER: CircuitBreakerOptions = { failureThreshold: 3, coolDownMs: 5_000 };

const hasInk = (strokes: readonly Stroke[]): boolean => strokes.some((stroke) => stroke.length > 0);

export class FallbackRecognizer implements SketchRanker {
  readonly #primary: UnreliableSketchRanker;
  readonly #floor: SketchRanker;
  readonly #breaker: CircuitBreaker;
  readonly #onPrimaryAvailabilityChange: (available: boolean) => void;
  #lastAnsweredBy: RecognizerSource | null = null;

  constructor(
    primary: UnreliableSketchRanker,
    floor: SketchRanker,
    settings: Partial<FallbackSettings> = {},
  ) {
    this.#primary = primary;
    this.#floor = floor;
    this.#breaker = new CircuitBreaker(settings.breaker ?? DEFAULT_BREAKER, settings.now);
    this.#onPrimaryAvailabilityChange = settings.onPrimaryAvailabilityChange ?? (() => {});
  }

  get lastAnsweredBy(): RecognizerSource | null {
    return this.#lastAnsweredBy;
  }

  async read(strokes: readonly Stroke[], options: RankOptions = {}): Promise<Reading> {
    return (await this.readWithSource(strokes, options)).reading;
  }

  async readWithSource(
    strokes: readonly Stroke[],
    options: RankOptions = {},
  ): Promise<SourcedReading> {
    const fromPrimary =
      hasInk(strokes) && this.#breaker.tryEnter() ? await this.#askPrimary(strokes, options) : null;
    const answer: SourcedReading =
      fromPrimary === null
        ? { source: "floor", reading: await this.#floor.read(strokes, options) }
        : { source: "primary", reading: fromPrimary };
    this.#lastAnsweredBy = answer.source;
    return answer;
  }

  async #askPrimary(strokes: readonly Stroke[], options: RankOptions): Promise<Reading | null> {
    const reading = await this.#primary.read(strokes, options).catch(() => null);
    const wasOpen = this.#breaker.isOpen;
    if (reading === null) this.#breaker.recordFailure();
    else this.#breaker.recordSuccess();
    if (this.#breaker.isOpen !== wasOpen) this.#onPrimaryAvailabilityChange(!this.#breaker.isOpen);
    return reading;
  }
}
