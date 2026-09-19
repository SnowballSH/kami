import type { StrokeFont } from "./strokeFont";

/** The font's em square as a share of the line height; the rest is the air between lines. */
export const EM_SHARE_OF_LINE_HEIGHT = 0.8;

const MIN_LINE_HEIGHT = 1;

/** How writing sits in its lines, in world px: baselines are `lineHeight` apart, glyphs an em tall. */
export interface LineMetrics {
  readonly lineHeight: number;
  readonly emSize: number;
  readonly pxPerFontUnit: number;
  /** From the top of a line down to its baseline, with the em square centred in the line. */
  readonly baselineOffset: number;
}

export const lineMetrics = (requestedLineHeight: number, font: StrokeFont): LineMetrics => {
  const lineHeight = Math.max(requestedLineHeight, MIN_LINE_HEIGHT);
  const emSize = lineHeight * EM_SHARE_OF_LINE_HEIGHT;
  const pxPerFontUnit = emSize / font.emHeight;
  return {
    lineHeight,
    emSize,
    pxPerFontUnit,
    baselineOffset: (lineHeight - emSize) / 2 + font.ascent * pxPerFontUnit,
  };
};
