import { countNumbers } from "./amounts";
import { normalise } from "./normalise";
import type { Recogniser } from "./recogniser";
import { recogniseAir } from "./recognisers/air";
import { recogniseBounciness } from "./recognisers/bounciness";
import { recogniseDials } from "./recognisers/dials";
import { recogniseFriction } from "./recognisers/friction";
import { recogniseGravity } from "./recognisers/gravity";
import { recogniseHeed } from "./recognisers/heed";
import { recogniseMotion } from "./recognisers/motion";
import { recognisePaper } from "./recognisers/paper";
import { recogniseReset } from "./recognisers/resets";
import { recogniseTime } from "./recognisers/time";
import { recogniseWind } from "./recognisers/wind";
import type { CompiledRule, RuleCompiler } from "./types";

const RECOGNISERS: readonly Recogniser[] = [
  recogniseReset,
  recognisePaper,
  recogniseGravity,
  recogniseTime,
  recogniseFriction,
  recogniseBounciness,
  recogniseAir,
  recogniseWind,
  recogniseDials,
  recogniseHeed,
  recogniseMotion,
];

const MAX_NUMBERS = 1;

export class GrammarRuleCompiler implements RuleCompiler {
  readonly #recognisers: readonly Recogniser[];

  constructor(recognisers: readonly Recogniser[] = RECOGNISERS) {
    this.#recognisers = recognisers;
  }

  compile(text: string): Promise<CompiledRule | null> {
    return Promise.resolve(this.#read(text));
  }

  #read(text: string): CompiledRule | null {
    const sentence = normalise(text);
    if (countNumbers(sentence.words) > MAX_NUMBERS) return null;
    for (const recognise of this.#recognisers) {
      const rule = recognise(sentence);
      if (rule !== null) return rule;
    }
    return null;
  }
}
