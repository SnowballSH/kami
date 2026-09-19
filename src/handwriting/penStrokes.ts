import type { Stroke, Vec } from "../core/geometry";
import type { LaidOutLine, PlacedGlyph } from "./layout";
import type { LineMetrics } from "./lineMetrics";
import { longerLift, type PenLift, type PlannedStroke } from "./timing";
import { driftAt, type GlyphJitter, type LineDrift, type Wobble } from "./wobble";

export interface Page {
  readonly origin: Vec;
  readonly metrics: LineMetrics;
}

interface LineFrame {
  readonly left: number;
  readonly baseline: number;
  readonly scale: number;
  readonly drift: LineDrift;
}

const inkGlyphStroke = (
  stroke: Stroke,
  placed: PlacedGlyph,
  jitter: GlyphJitter,
  line: LineFrame,
): Stroke =>
  stroke.map((point) => {
    const local = {
      x: point.x * line.scale * jitter.scale,
      y: point.y * line.scale * jitter.scale,
    };
    const along = placed.x * line.scale + local.x - local.y * jitter.slant + jitter.nudge.x;
    return {
      x: line.left + along,
      y: line.baseline + local.y + jitter.nudge.y + driftAt(line.drift, along),
    };
  });

/** Every stroke of the laid-out text in writing order, in world space, with the lift that precedes it. */
export const planStrokes = (
  lines: readonly LaidOutLine[],
  { origin, metrics }: Page,
  wobble: Wobble,
): PlannedStroke[] => {
  const planned: PlannedStroke[] = [];
  let lift: PenLift = "start";
  lines.forEach((words, lineIndex) => {
    const line: LineFrame = {
      left: origin.x,
      baseline: origin.y + lineIndex * metrics.lineHeight + metrics.baselineOffset,
      scale: metrics.pxPerFontUnit,
      drift: wobble.nextLine(),
    };
    for (const word of words) {
      for (const placed of word) {
        const jitter = wobble.nextGlyph();
        for (const stroke of placed.glyph.strokes) {
          planned.push({
            points: wobble.waver(inkGlyphStroke(stroke, placed, jitter, line)),
            lift,
          });
          lift = "stroke";
        }
      }
      lift = longerLift(lift, "word");
    }
    lift = longerLift(lift, "line");
  });
  return planned;
};
