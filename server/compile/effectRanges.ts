import { clampEffectValue } from "../../src/rules/effectDomains";
import { isBodyEffect, type RuleEffect, type Target } from "../../src/rules/types";

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

const describeTarget = (of: Target): string =>
  of.kind === "all" ? "everything" : `the ${of.name}`;

export const describeEffect = (effect: RuleEffect): string => {
  const dial =
    "value" in effect
      ? `${effect.governs} = ${tidy(effect.value)}`
      : `${effect.governs} = (${tidy(effect.x)}, ${tidy(effect.y)}) g`;
  return isBodyEffect(effect) ? `${describeTarget(effect.of)}: ${dial}` : dial;
};
