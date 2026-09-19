import { clamp } from "../../src/core/geometry";
import type { Governs, RuleEffect } from "../../src/rules/types";

interface Range {
  readonly min: number;
  readonly max: number;
}

export const EFFECT_RANGES: Readonly<Record<Governs, Range>> = {
  gravity: { min: -30, max: 30 },
  wind: { min: -3, max: 3 },
  timeScale: { min: 0.1, max: 3 },
  airDrag: { min: 0, max: 10 },
  friction: { min: 0, max: 10 },
  bounciness: { min: 0, max: 1 },
};

export const clampEffect = (effect: RuleEffect): RuleEffect => {
  const { min, max } = EFFECT_RANGES[effect.governs];
  return "value" in effect
    ? { ...effect, value: clamp(effect.value, min, max) }
    : { ...effect, x: clamp(effect.x, min, max), y: clamp(effect.y, min, max) };
};

const GLOSS_DECIMALS = 2;

const tidy = (value: number): string => String(Number(value.toFixed(GLOSS_DECIMALS)));

export const describeEffect = (effect: RuleEffect): string =>
  "value" in effect
    ? `${effect.governs} = ${tidy(effect.value)}`
    : `${effect.governs} = (${tidy(effect.x)}, ${tidy(effect.y)}) g`;
