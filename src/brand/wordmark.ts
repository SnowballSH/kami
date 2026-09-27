import { boundsOf, expandRect, type Rect, type Stroke } from "../core/geometry";
import { createHandwriting } from "../handwriting";
import { EM_SHARE_OF_LINE_HEIGHT } from "../handwriting/lineMetrics";
import { ALICE_FOOT, ALICE_HALF_WIDTH, ALICE_HEIGHT, aliceSvg } from "./alice";
import { SUMIKUI_BOB, SUMIKUI_REACH, sumikuiBob, sumikuiSvg } from "./sumikui";
import { inkPath, svgDocument } from "./svg";

export const WORDMARK_TEXT = "kami";
export const WORDMARK_FRAMES = 24;
export const WORDMARK_SEED = 12;
const WORDMARK_STEM = WORDMARK_TEXT.slice(0, -1);

const LINE_HEIGHT = 100;
const PEN_SHARE_OF_EM = 0.085;
export const PADDING_SHARE = 0.18;
const ALICE_PEN_SHARE = 0.45;
const ALICE_NUDGE_RIGHT = 0.04;
const SUMIKUI_DOT_SHARE = 0.105;
const SUMIKUI_GAP = 0.07;

const handwriting = createHandwriting();

export interface Written {
  readonly strokes: readonly Stroke[];
  readonly bounds: Rect;
  readonly emSize: number;
}

/** Kami writes a word in his own hand, the same wobbling stroke font his notes use. */
export const writeWord = (text: string, seed: number, lineHeight = LINE_HEIGHT): Written => {
  const script = handwriting.write(text, {
    origin: { x: 0, y: 0 },
    size: lineHeight,
    maxWidth: Number.POSITIVE_INFINITY,
    seed,
  });
  return {
    strokes: script.strokes,
    bounds: script.bounds,
    emSize: lineHeight * EM_SHARE_OF_LINE_HEIGHT,
  };
};

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};

interface DottedLetter {
  readonly stem: Rect;
  readonly dot: Rect;
}

const splitDotted = (strokes: readonly Stroke[]): DottedLetter => {
  const [first, second] = strokes.map(boundsOf);
  if (first === undefined || second === undefined) throw new Error("the i needs a stem and a dot");
  return first.height >= second.height
    ? { stem: first, dot: second }
    : { stem: second, dot: first };
};

export interface Wordmark {
  readonly body: string;
  readonly bounds: Rect;
  readonly emSize: number;
}

/**
 * "kam" in Kami's hand, and where the "i" would be: Alice as the stem, standing on the baseline, only as
 * tall as the letter's stem; the Sumikui as the dot above her, in the same ink. `phase` (0..1) is a moment
 * of the Sumikui's breathing, for animated frames.
 */
export const wordmark = (seed: number, phase: number): Wordmark => {
  const word = writeWord(WORDMARK_TEXT, seed);
  const stem = writeWord(WORDMARK_STEM, seed);
  const letters = word.strokes.slice(0, stem.strokes.length);
  const dotted = splitDotted(word.strokes.slice(stem.strokes.length));
  const pen = word.emSize * PEN_SHARE_OF_EM;
  const baseline = dotted.stem.y + dotted.stem.height;
  const scale = dotted.stem.height / ALICE_HEIGHT;
  const centreX = dotted.stem.x + dotted.stem.width / 2 + word.emSize * ALICE_NUDGE_RIGHT;
  const at = { x: centreX, y: baseline - ALICE_FOOT.y * scale };
  const alice: Rect = {
    x: centreX - ALICE_HALF_WIDTH * scale,
    y: dotted.stem.y,
    width: 2 * ALICE_HALF_WIDTH * scale,
    height: dotted.stem.height,
  };
  const radius = word.emSize * SUMIKUI_DOT_SHARE;
  const perch = {
    x: centreX + (dotted.dot.x + dotted.dot.width / 2 - centreX) * 0.5,
    y: dotted.stem.y - word.emSize * SUMIKUI_GAP - radius,
  };
  const reach = radius * (SUMIKUI_REACH + SUMIKUI_BOB);
  const sumikui: Rect = {
    x: perch.x - reach,
    y: perch.y - reach,
    width: 2 * reach,
    height: 2 * reach,
  };
  return {
    body:
      inkPath(letters, pen) +
      aliceSvg(at, scale, (pen * ALICE_PEN_SHARE) / scale) +
      sumikuiSvg(sumikuiBob(perch, radius, phase), radius, phase),
    bounds: union(union(stem.bounds, alice), sumikui),
    emSize: word.emSize,
  };
};

/** The wordmark, cropped to the ink with a little paper around it; `phase` picks a frame of the Sumikui. */
export const wordmarkSvg = (seed = WORDMARK_SEED, phase = 0): string => {
  const mark = wordmark(seed, phase);
  return svgDocument(
    expandRect(mark.bounds, mark.emSize * PADDING_SHARE),
    mark.body,
    WORDMARK_TEXT,
  );
};

/** One breath of the Sumikui as frames of the wordmark, for the animated logo. */
export const wordmarkFrames = (seed = WORDMARK_SEED, frames = WORDMARK_FRAMES): readonly string[] =>
  Array.from({ length: frames }, (_, index) => wordmarkSvg(seed, index / frames));
