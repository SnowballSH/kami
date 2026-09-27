import { expandRect, type Rect, type Stroke, type Vec } from "../core/geometry";
import { MARKER, rgbCss } from "../render/palette";
import { ALICE_FOOT, aliceSvg } from "./alice";
import { inkPath, PAPER, round, svgBody, svgDocument } from "./svg";
import { PADDING_SHARE, WORDMARK_SEED, WORDMARK_TEXT, wordmark, writeWord } from "./wordmark";

const MARK_SEED = 12;
const SIZE = 64;
const CORNER = 14;
const LINE_Y = 47;
const LINE = { from: 9, to: 55, pen: 2.6 } as const;
const LETTER = { height: 33, stretch: 1.25, left: 11, pen: 5 } as const;
const EDGE = { width: 1.5, alpha: 0.14 } as const;
const ALICE = { x: 47, scale: 0.6, sink: 0.6 } as const;
const LOCKUP = { markHeight: 1.15, gap: 0.35 } as const;

/** A hand-drawn line with a slight sag, as if ruled by someone who wasn't trying too hard. */
const drawnLine = (from: number, to: number, y: number, seed: number): Stroke => {
  const steps = 24;
  const points: Vec[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const sag = Math.sin(Math.PI * t) * 0.6;
    const waver = Math.sin(t * 9 + seed) * 0.25;
    points.push({ x: from + (to - from) * t, y: y + sag + waver });
  }
  return points;
};

const standOnBaseline = (strokes: readonly Stroke[], bounds: Rect, baseline: number): Stroke[] => {
  const scale = LETTER.height / bounds.height;
  return strokes.map((stroke) =>
    stroke.map(({ x, y }) => ({
      x: LETTER.left + (x - bounds.x) * scale * LETTER.stretch,
      y: baseline - (bounds.y + bounds.height - y) * scale,
    })),
  );
};

/**
 * The app mark: a rounded paper tile, a hand-drawn line, Kami's "k" on it and Alice standing beside it —
 * draw a line, she walks. Reads at 32 px; the same file serves as favicon and home-screen icon.
 */
export const markSvg = (seed = MARK_SEED): string => {
  const letter = writeWord("k", seed);
  const inset = EDGE.width / 2;
  const body =
    `<rect width="${SIZE}" height="${SIZE}" rx="${CORNER}" fill="${PAPER}"/>` +
    `<rect x="${inset}" y="${inset}" width="${SIZE - EDGE.width}" height="${SIZE - EDGE.width}" rx="${CORNER - inset}" fill="none" stroke="${rgbCss(MARKER.black, EDGE.alpha)}" stroke-width="${EDGE.width}"/>` +
    inkPath([drawnLine(LINE.from, LINE.to, LINE_Y, seed)], LINE.pen) +
    inkPath(standOnBaseline(letter.strokes, letter.bounds, LINE_Y - 1), LETTER.pen) +
    aliceSvg({ x: ALICE.x, y: LINE_Y - ALICE_FOOT.y * ALICE.scale - ALICE.sink }, ALICE.scale);
  return svgDocument({ x: 0, y: 0, width: SIZE, height: SIZE }, body, "Kami");
};

/** Wordmark and mark side by side on one line, for READMEs and headers. */
export const lockupSvg = (seed = WORDMARK_SEED): string => {
  const word = wordmark(seed, 0);
  const markScale = (word.bounds.height * LOCKUP.markHeight) / SIZE;
  const markLeft = word.bounds.x - SIZE * markScale - word.emSize * LOCKUP.gap;
  const markTop = word.bounds.y + word.bounds.height / 2 - (SIZE * markScale) / 2;
  const box = expandRect(
    { ...word.bounds, x: markLeft, width: word.bounds.x + word.bounds.width - markLeft },
    word.emSize * PADDING_SHARE,
  );
  return svgDocument(
    box,
    `<g transform="translate(${round(markLeft)} ${round(markTop)}) scale(${round(markScale)})">${svgBody(markSvg())}</g>${word.body}`,
    WORDMARK_TEXT,
  );
};
