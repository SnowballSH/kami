import { getStroke, type StrokeOptions } from "perfect-freehand";
import type { Rect, Stroke, Vec } from "../core/geometry";
import { createHandwriting } from "../handwriting";
import { tightBounds } from "../handwriting/bounds";
import { MARKER, rgbCss } from "../render/palette";

export const WORDMARK_TEXT = "kami";
export const WORDMARK_SEED = 12;
export const MARK_SEED = 12;

const INK = rgbCss(MARKER.black);
const PAPER = "#ffffff";
const LINE_HEIGHT = 100;
const PEN_SHARE_OF_EM = 0.085;
const PADDING_SHARE = 0.18;
const ROUND = 2;

const LOGO_PEN: StrokeOptions = {
  thinning: 0.4,
  smoothing: 0.5,
  streamline: 0.2,
  simulatePressure: true,
  last: true,
};

const round = (value: number): string => value.toFixed(ROUND).replace(/\.?0+$/, "");

const outlinePath = (stroke: Stroke, size: number): string => {
  const outline = getStroke([...stroke], { ...LOGO_PEN, size });
  const [start] = outline;
  if (start === undefined) return "";
  const parts = [`M${round(start[0])} ${round(start[1])}`];
  outline.forEach((point, index) => {
    const next = outline[(index + 1) % outline.length] ?? point;
    parts.push(
      `Q${round(point[0])} ${round(point[1])} ${round((point[0] + next[0]) / 2)} ${round((point[1] + next[1]) / 2)}`,
    );
  });
  parts.push("Z");
  return parts.join("");
};

/** Every stroke of a piece of handwriting as one filled SVG path: fountain-pen ink, thick where the hand slowed. */
export const inkPath = (strokes: readonly Stroke[], penSize: number): string =>
  `<path fill="${INK}" d="${strokes.map((stroke) => outlinePath(stroke, penSize)).join("")}"/>`;

const pad = (bounds: Rect, amount: number): Rect => ({
  x: bounds.x - amount,
  y: bounds.y - amount,
  width: bounds.width + 2 * amount,
  height: bounds.height + 2 * amount,
});

const viewBox = ({ x, y, width, height }: Rect): string =>
  [x, y, width, height].map(round).join(" ");

const svg = (box: Rect, body: string, title: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox(box)}" role="img" aria-label="${title}">${body}</svg>\n`;

export interface Written {
  readonly strokes: readonly Stroke[];
  readonly bounds: Rect;
  readonly emSize: number;
}

/** Kami writes a word in his own hand, the same wobbling stroke font his notes use. */
export const writeWord = (text: string, seed: number, lineHeight = LINE_HEIGHT): Written => {
  const script = createHandwriting().write(text, {
    origin: { x: 0, y: 0 },
    size: lineHeight,
    maxWidth: Number.POSITIVE_INFINITY,
    seed,
  });
  return { strokes: script.strokes, bounds: script.bounds, emSize: lineHeight * 0.8 };
};

/** The wordmark: "kami" written by Kami, cropped to the ink with a little paper around it. */
export const wordmarkSvg = (seed = WORDMARK_SEED): string => {
  const word = writeWord(WORDMARK_TEXT, seed);
  const pen = word.emSize * PEN_SHARE_OF_EM;
  const box = pad(word.bounds, word.emSize * PADDING_SHARE);
  return svg(box, inkPath(word.strokes, pen), WORDMARK_TEXT);
};

const MARK_SIZE = 64;
const MARK_CORNER = 14;
const MARK_LINE_Y = 47;
const MARK_LINE = { from: 9, to: 55 } as const;
const MARK_LETTER_HEIGHT = 33;
const MARK_LETTER_STRETCH = 1.25;
const MARK_LETTER_LEFT = 11;
const MARK_PEN = 5;
const MARK_EDGE = { width: 1.5, alpha: 0.14 } as const;
const MARK_ALICE = { x: 47, scale: 0.6 } as const;

const ALICE_LINE_WIDTH = 2.2;
const ALICE_HEAD = { x: 0.5, y: -21.5, radius: 7.5 } as const;
const ALICE_EYE = { x: 4, y: -22.5, radius: 1 } as const;
const ALICE_HAIR = { start: { x: -5, y: -27 }, bend: { x: -12.5, y: -22 }, end: { x: -9, y: -9 } };
const ALICE_DRESS: readonly Vec[] = [
  { x: 0, y: -14 },
  { x: 11.5, y: 13 },
  { x: -11.5, y: 13 },
];
const ALICE_SHOULDER = 11.5;
const ALICE_HIP = { x: 3.5, y: 13 } as const;
const ALICE_HAND = { x: 8, y: 3 } as const;
const ALICE_FOOT = { x: 4, y: 28.5 } as const;
const ALICE_TOE = 3.5;

const line = (from: Vec, to: Vec): string =>
  `M${round(from.x)} ${round(from.y)}L${round(to.x)} ${round(to.y)}`;

/** Alice as the game draws her, standing, facing right, feet on y = 28.5 of her own frame. */
export const aliceSvg = (at: Vec, scale: number): string => {
  const stroke = `fill="none" stroke="${INK}" stroke-width="${ALICE_LINE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"`;
  const leg = (hip: Vec, foot: Vec): string => `${line(hip, foot)}l${ALICE_TOE} 0`;
  const limbs = [
    line({ x: -3, y: -ALICE_SHOULDER }, { x: -ALICE_HAND.x, y: ALICE_HAND.y }),
    leg({ x: -ALICE_HIP.x, y: ALICE_HIP.y }, { x: -ALICE_FOOT.x, y: ALICE_FOOT.y }),
    leg(ALICE_HIP, ALICE_FOOT),
    `M${ALICE_HAIR.start.x} ${ALICE_HAIR.start.y}Q${ALICE_HAIR.bend.x} ${ALICE_HAIR.bend.y} ${ALICE_HAIR.end.x} ${ALICE_HAIR.end.y}`,
  ].join("");
  const dress = `${ALICE_DRESS.map(({ x, y }, i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join("")}Z`;
  const frontArm = line({ x: 3, y: -ALICE_SHOULDER }, ALICE_HAND);
  return (
    `<g transform="translate(${round(at.x)} ${round(at.y)}) scale(${scale})">` +
    `<path ${stroke} d="${limbs}"/>` +
    `<path fill="${PAPER}" stroke="${INK}" stroke-width="${ALICE_LINE_WIDTH}" stroke-linejoin="round" d="${dress}"/>` +
    `<circle cx="${ALICE_HEAD.x}" cy="${ALICE_HEAD.y}" r="${ALICE_HEAD.radius}" fill="${PAPER}" stroke="${INK}" stroke-width="${ALICE_LINE_WIDTH}"/>` +
    `<circle cx="${ALICE_EYE.x}" cy="${ALICE_EYE.y}" r="${ALICE_EYE.radius}" fill="${INK}"/>` +
    `<path fill="none" stroke="${INK}" stroke-width="3.2" d="M${round(ALICE_HEAD.x + ALICE_HEAD.radius * Math.cos(1.1 * Math.PI))} ${round(ALICE_HEAD.y + ALICE_HEAD.radius * Math.sin(1.1 * Math.PI))}A${ALICE_HEAD.radius} ${ALICE_HEAD.radius} 0 0 1 ${round(ALICE_HEAD.x + ALICE_HEAD.radius * Math.cos(1.75 * Math.PI))} ${round(ALICE_HEAD.y + ALICE_HEAD.radius * Math.sin(1.75 * Math.PI))}"/>` +
    `<path ${stroke} d="${frontArm}"/>` +
    "</g>"
  );
};

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

const scaleTo = (
  strokes: readonly Stroke[],
  bounds: Rect,
  height: number,
  left: number,
  baseline: number,
  stretch: number,
): Stroke[] => {
  const scale = height / bounds.height;
  return strokes.map((stroke) =>
    stroke.map(({ x, y }) => ({
      x: left + (x - bounds.x) * scale * stretch,
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
  const letterStrokes = scaleTo(
    letter.strokes,
    letter.bounds,
    MARK_LETTER_HEIGHT,
    MARK_LETTER_LEFT,
    MARK_LINE_Y - 1,
    MARK_LETTER_STRETCH,
  );
  const ground = drawnLine(MARK_LINE.from, MARK_LINE.to, MARK_LINE_Y, seed);
  const inset = MARK_EDGE.width / 2;
  const body =
    `<rect width="${MARK_SIZE}" height="${MARK_SIZE}" rx="${MARK_CORNER}" fill="${PAPER}"/>` +
    `<rect x="${inset}" y="${inset}" width="${MARK_SIZE - MARK_EDGE.width}" height="${MARK_SIZE - MARK_EDGE.width}" rx="${MARK_CORNER - inset}" fill="none" stroke="${rgbCss(MARKER.black, MARK_EDGE.alpha)}" stroke-width="${MARK_EDGE.width}"/>` +
    inkPath([ground], 2.6) +
    inkPath(letterStrokes, MARK_PEN) +
    aliceSvg({ x: MARK_ALICE.x, y: MARK_LINE_Y - 28.5 * MARK_ALICE.scale - 0.6 }, MARK_ALICE.scale);
  return svg({ x: 0, y: 0, width: MARK_SIZE, height: MARK_SIZE }, body, "Kami");
};

/** Wordmark and mark side by side on one line, for READMEs and headers. */
export const lockupSvg = (seed = WORDMARK_SEED): string => {
  const word = writeWord(WORDMARK_TEXT, seed);
  const pen = word.emSize * PEN_SHARE_OF_EM;
  const markScale = (word.bounds.height * 1.15) / MARK_SIZE;
  const markLeft = word.bounds.x - MARK_SIZE * markScale - word.emSize * 0.35;
  const markTop = word.bounds.y + word.bounds.height / 2 - (MARK_SIZE * markScale) / 2;
  const box = pad(
    { ...word.bounds, x: markLeft, width: word.bounds.x + word.bounds.width - markLeft },
    word.emSize * PADDING_SHARE,
  );
  const mark = markSvg().replace(/^<svg[^>]*>|<\/svg>\n$/g, "");
  return svg(
    box,
    `<g transform="translate(${round(markLeft)} ${round(markTop)}) scale(${round(markScale)})">${mark}</g>` +
      inkPath(word.strokes, pen),
    WORDMARK_TEXT,
  );
};

export const logoBounds = tightBounds;
