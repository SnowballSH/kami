import { clamp } from "../../src/core/geometry";
import { type Governs, isBodyEffect, type RuleEffect, type Target } from "../../src/rules/types";

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
  temperature: { min: -100, max: 1000 },
  daylight: { min: 0, max: 1 },
  flight: { min: 0, max: 1 },
  walkSpeed: { min: 0.1, max: 5 },
  aliceSize: { min: 0.25, max: 4 },
  attraction: { min: -3, max: 3 },
  clones: { min: 0, max: 8 },
  inkEater: { min: 0, max: 1 },
  spin: { min: -5, max: 5 },
  thrust: { min: -3, max: 3 },
  mass: { min: 0.1, max: 10 },
  bounce: { min: 0, max: 1 },
  grip: { min: 0, max: 5 },
};

export const clampEffect = (effect: RuleEffect): RuleEffect => {
  const { min, max } = EFFECT_RANGES[effect.governs];
  return "value" in effect
    ? { ...effect, value: clamp(effect.value, min, max) }
    : { ...effect, x: clamp(effect.x, min, max), y: clamp(effect.y, min, max) };
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
