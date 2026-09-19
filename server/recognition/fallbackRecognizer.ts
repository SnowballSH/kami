/**
 * Asks the primary recogniser and, whenever it has no answer, the floor — so the caller always gets
 * a ranking. A circuit breaker keeps a dead primary from costing a timeout on every sketch.
 */
import type { Stroke } from "../../src/core/geometry";
import { CircuitBreaker, type CircuitBreakerOptions, type Clock } from "./circuitBreaker";
import type { Ranking, RankOptions, SketchRanker, UnreliableSketchRanker } from "./types";

export type RecognizerSource = "primary" | "floor";

export interface SourcedRanking {
  readonly source: RecognizerSource;
  readonly ranking: Ranking;
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

  async rank(strokes: readonly Stroke[], options: RankOptions = {}): Promise<Ranking> {
    return (await this.rankWithSource(strokes, options)).ranking;
  }

  async rankWithSource(
    strokes: readonly Stroke[],
    options: RankOptions = {},
  ): Promise<SourcedRanking> {
    const fromPrimary =
      hasInk(strokes) && this.#breaker.tryEnter() ? await this.#askPrimary(strokes, options) : null;
    const answer: SourcedRanking =
      fromPrimary === null
        ? { source: "floor", ranking: await this.#floor.rank(strokes, options) }
        : { source: "primary", ranking: fromPrimary };
    this.#lastAnsweredBy = answer.source;
    return answer;
  }

  async #askPrimary(strokes: readonly Stroke[], options: RankOptions): Promise<Ranking | null> {
    const ranking = await this.#primary.rank(strokes, options).catch(() => null);
    const wasOpen = this.#breaker.isOpen;
    if (ranking === null) this.#breaker.recordFailure();
    else this.#breaker.recordSuccess();
    if (this.#breaker.isOpen !== wasOpen) this.#onPrimaryAvailabilityChange(!this.#breaker.isOpen);
    return ranking;
  }
}
