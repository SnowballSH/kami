import { clampEffectValue } from "../../src/rules/effectDomains";
import type { RuleEffect } from "../../src/rules/types";

export { EFFECT_DOMAINS as EFFECT_RANGES } from "../../src/rules/effectDomains";

export const clampEffect = (effect: RuleEffect): RuleEffect =>
  "value" in effect
    ? { ...effect, value: clampEffectValue(effect.governs, effect.value) }
    : {
        ...effect,
        x: clampEffectValue(effect.governs, effect.x),
        y: clampEffectValue(effect.governs, effect.y),
      };

const GLOSS_DECIMALS = 2;

const tidy = (value: number): string => String(Number(value.toFixed(GLOSS_DECIMALS)));

export const describeEffect = (effect: RuleEffect): string =>
  "value" in effect
    ? `${effect.governs} = ${tidy(effect.value)}`
    : `${effect.governs} = (${tidy(effect.x)}, ${tidy(effect.y)}) g`;
