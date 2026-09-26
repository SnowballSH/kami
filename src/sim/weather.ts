import type { Nature } from "../cat/types";
import { clamp } from "../core/geometry";
import { FLOAT_FULL_LIFT_SPAN_C, FLOAT_HOVERS_AT_C, FLOAT_LIFT_RANGE } from "./constants";
import type { InkEntity } from "./inkEntity";

/** Natures that perish in heat, and the temperature (°C) past which they start to go. */
const PERISHES_ABOVE: Readonly<Partial<Record<Nature, number>>> = {
  slippery: 30,
  floaty: 60,
};

/** Degree-milliseconds of excess heat a drawing survives: 60 °C over its point lasts 1.5 s. */
const PERISH_BUDGET = 60 * 1_500;

/**
 * How strongly warm air lifts a floaty drawing, as a multiple of its lift on Earth: 1 at 20 °C,
 * rising faster in the heat (until it burns off), hovering at −10 °C and sinking gently below.
 */
export const floatLiftAt = (temperature: number): number =>
  clamp(
    (temperature - FLOAT_HOVERS_AT_C) / FLOAT_FULL_LIFT_SPAN_C,
    FLOAT_LIFT_RANGE.min,
    FLOAT_LIFT_RANGE.max,
  );

export interface WeatherReport {
  readonly perished: readonly InkEntity[];
}

/** Warms every drawing by the world's temperature; the ones past their point melt or evaporate. */
export const weather = (
  temperature: number,
  inks: readonly InkEntity[],
  elapsedMs: number,
): WeatherReport => {
  const perished: InkEntity[] = [];
  for (const ink of inks) {
    const point = PERISHES_ABOVE[ink.nature];
    if (point === undefined) {
      ink.warmth = 0;
      continue;
    }
    const excess = temperature - point;
    ink.warmth = excess > 0 ? ink.warmth + excess * elapsedMs : 0;
    if (ink.warmth >= PERISH_BUDGET) perished.push(ink);
  }
  return { perished };
};
