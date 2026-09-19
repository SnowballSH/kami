import type { Nature } from "../cat/types";
import type { InkEntity } from "./inkEntity";

/** Natures that perish in heat, and the temperature (°C) past which they start to go. */
const PERISHES_ABOVE: Readonly<Partial<Record<Nature, number>>> = {
  slippery: 30,
  floaty: 60,
};

/** Degree-milliseconds of excess heat a drawing survives: 60 °C over its point lasts 1.5 s. */
const PERISH_BUDGET = 60 * 1_500;

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
