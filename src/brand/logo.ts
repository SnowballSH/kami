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

const strokesBounds = (strokes: readonly Stroke[]): Rect => {
  const points = strokes.flat();
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

const WORDMARK_STEM = WORDMARK_TEXT.slice(0, -1);
const ALICE_HALF_WIDTH = 12.5;
const ALICE_PEN_SHARE = 0.45;
const ALICE_NUDGE_RIGHT = 0.04;
const SUMIKUI_DOT_SHARE = 0.105;
const SUMIKUI_GAP = 0.07;

interface Wordmark {
  readonly body: string;
  readonly bounds: Rect;
  readonly emSize: number;
}

interface DottedLetter {
  readonly stem: Rect;
  readonly dot: Rect;
}

const splitDotted = (strokes: readonly Stroke[]): DottedLetter => {
  const [first, second] = strokes.map((stroke) => strokesBounds([stroke]));
  if (first === undefined || second === undefined) throw new Error("the i needs a stem and a dot");
  return first.height >= second.height
    ? { stem: first, dot: second }
    : { stem: second, dot: first };
};

/**
 * "kam" in Kami's hand, and where the "i" would be: Alice as the stem, standing on the baseline, only as
 * tall as the letter's stem; the Sumikui as the dot above her, in the same ink. `phase` (0..1) is a moment
 * of the Sumikui's breathing, for animated frames.
 */
const wordmark = (seed: number, phase: number): Wordmark => {
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
  const dotAt = { x: perch.x, y: perch.y + Math.sin(phase * TAU) * radius * SUMIKUI_BOB };
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
      sumikuiSvg(dotAt, radius, phase),
    bounds: union(union(stem.bounds, alice), sumikui),
    emSize: word.emSize,
  };
};

/** The wordmark, cropped to the ink with a little paper around it; `phase` picks a frame of the Sumikui. */
export const wordmarkSvg = (seed = WORDMARK_SEED, phase = 0): string => {
  const mark = wordmark(seed, phase);
  return svg(pad(mark.bounds, mark.emSize * PADDING_SHARE), mark.body, WORDMARK_TEXT);
};

export const WORDMARK_FRAMES = 24;

/** One breath of the Sumikui as frames of the wordmark, for the animated logo. */
export const wordmarkFrames = (seed = WORDMARK_SEED, frames = WORDMARK_FRAMES): readonly string[] =>
  Array.from({ length: frames }, (_, index) => wordmarkSvg(seed, index / frames));

const SUMIKUI_LOBES = 7;
const SUMIKUI_WOBBLE = 0.2;
const SUMIKUI_REACH = 1.12 * (1 + SUMIKUI_WOBBLE);
const SUMIKUI_BOB = 0.12;
const SUMIKUI_EYE = { x: 0.3, y: -0.12, radius: 0.27, pupil: 0.13 } as const;
const SUMIKUI_BLINK = { at: 0.72, span: 0.08 } as const;
const TAU = Math.PI * 2;

const polar = (angle: number, radius: number): Vec => ({
  x: Math.cos(angle) * radius,
  y: Math.sin(angle) * radius,
});

const blotPath = (radius: number, phase: number): string => {
  const lobe = (index: number): number =>
    radius * (1 + SUMIKUI_WOBBLE * Math.sin(phase * TAU + (index % SUMIKUI_LOBES) * 1.9));
  const start = polar(0, lobe(0));
  const parts = [`M${round(start.x)} ${round(start.y)}`];
  for (let index = 1; index <= SUMIKUI_LOBES; index++) {
    const angle = (index / SUMIKUI_LOBES) * TAU;
    const previous = ((index - 1) / SUMIKUI_LOBES) * TAU;
    const control = polar((angle + previous) / 2, ((lobe(index - 1) + lobe(index)) / 2) * 1.12);
    const point = polar(angle, lobe(index));
    parts.push(`Q${round(control.x)} ${round(control.y)} ${round(point.x)} ${round(point.y)}`);
  }
  parts.push("Z");
  return parts.join("");
};

const blinkSquint = (phase: number): number => {
  const distance = Math.abs(phase - SUMIKUI_BLINK.at);
  return distance >= SUMIKUI_BLINK.span ? 1 : Math.max(distance / SUMIKUI_BLINK.span, 0.1);
};

/** The Sumikui as the game draws it: a breathing blot of ink with one eye that watches Alice below. */
export const sumikuiSvg = (at: Vec, radius: number, phase = 0): string => {
  const eye = {
    x: SUMIKUI_EYE.x * radius,
    y: SUMIKUI_EYE.y * radius,
    radius: SUMIKUI_EYE.radius * radius,
    pupil: SUMIKUI_EYE.pupil * radius,
  };
  const squint = blinkSquint(phase);
  return (
    `<g transform="translate(${round(at.x)} ${round(at.y)})">` +
    `<path fill="${INK}" d="${blotPath(radius, phase)}"/>` +
    `<g transform="translate(${round(eye.x)} ${round(eye.y)}) scale(1 ${round(squint)})">` +
    `<circle r="${round(eye.radius)}" fill="${PAPER}"/>` +
    `<circle cx="${round(eye.radius * 0.2)}" cy="${round(eye.radius * 0.25)}" r="${round(eye.pupil)}" fill="${INK}"/>` +
    "</g></g>"
  );
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
const ALICE_HEIGHT = ALICE_FOOT.y - (ALICE_HEAD.y - ALICE_HEAD.radius);
const ALICE_HAIR_WEIGHT = 1.45;

const line = (from: Vec, to: Vec): string =>
  `M${round(from.x)} ${round(from.y)}L${round(to.x)} ${round(to.y)}`;

/** Alice as the game draws her, standing, facing right, feet on y = 28.5 of her own frame. */
export const aliceSvg = (at: Vec, scale: number, lineWidth = ALICE_LINE_WIDTH): string => {
  const width = round(lineWidth);
  const stroke = `fill="none" stroke="${INK}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`;
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
    `<path fill="${PAPER}" stroke="${INK}" stroke-width="${width}" stroke-linejoin="round" d="${dress}"/>` +
    `<circle cx="${ALICE_HEAD.x}" cy="${ALICE_HEAD.y}" r="${ALICE_HEAD.radius}" fill="${PAPER}" stroke="${INK}" stroke-width="${width}"/>` +
    `<circle cx="${ALICE_EYE.x}" cy="${ALICE_EYE.y}" r="${ALICE_EYE.radius}" fill="${INK}"/>` +
    `<path fill="none" stroke="${INK}" stroke-width="${round(lineWidth * ALICE_HAIR_WEIGHT)}" d="M${round(ALICE_HEAD.x + ALICE_HEAD.radius * Math.cos(1.1 * Math.PI))} ${round(ALICE_HEAD.y + ALICE_HEAD.radius * Math.sin(1.1 * Math.PI))}A${ALICE_HEAD.radius} ${ALICE_HEAD.radius} 0 0 1 ${round(ALICE_HEAD.x + ALICE_HEAD.radius * Math.cos(1.75 * Math.PI))} ${round(ALICE_HEAD.y + ALICE_HEAD.radius * Math.sin(1.75 * Math.PI))}"/>` +
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
  const word = wordmark(seed, 0);
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
    `<g transform="translate(${round(markLeft)} ${round(markTop)}) scale(${round(markScale)})">${mark}</g>${word.body}`,
    WORDMARK_TEXT,
  );
};

export const logoBounds = tightBounds;
