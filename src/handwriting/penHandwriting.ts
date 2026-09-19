import type { Stroke } from "../core/geometry";
import { tightBounds } from "./bounds";
import { layOutText } from "./layout";
import { lineMetrics } from "./lineMetrics";
import { planStrokes } from "./penStrokes";
import { SeededRandom } from "./prng";
import { revealStrokes } from "./reveal";
import type { StrokeFont } from "./strokeFont";
import { scheduleStrokes } from "./timing";
import type { Handwriting, PenScript, WriteOptions } from "./types";
import { Wobble } from "./wobble";

export class PenHandwriting implements Handwriting {
  readonly #font: StrokeFont;

  constructor(font: StrokeFont) {
    this.#font = font;
  }

  write(text: string, { origin, size, maxWidth, seed }: WriteOptions): PenScript {
    const metrics = lineMetrics(size, this.#font);
    const lines = layOutText(text, this.#font, maxWidth / metrics.pxPerFontUnit);
    const wobble = new Wobble(new SeededRandom(seed), metrics.emSize);
    const planned = planStrokes(lines, { origin, metrics }, wobble);
    const strokes = planned.map((stroke) => stroke.points);
    return {
      text,
      strokes,
      ...scheduleStrokes(planned, metrics.emSize),
      bounds: tightBounds(strokes, origin),
    };
  }

  reveal(script: PenScript, elapsedMs: number): readonly Stroke[] {
    return revealStrokes(script, elapsedMs);
  }
}
