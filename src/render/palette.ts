import { NATURES, type Nature } from "../cat/types";
import type { NoteAuthor, NoteTone } from "../notes/types";

export type Rgb = readonly [red: number, green: number, blue: number];

export const MARKER = {
  black: [23, 23, 26],
  blue: [37, 99, 235],
  green: [22, 163, 74],
  red: [220, 38, 38],
} as const satisfies Record<string, Rgb>;

export const NATURE_TINTS: Readonly<Record<Nature, Rgb>> = {
  ink: MARKER.black,
  bouncy: [219, 39, 119],
  climbable: [146, 84, 30],
  floaty: [14, 165, 233],
  heavy: [71, 85, 105],
  light: [167, 139, 250],
  slippery: [13, 148, 136],
  sticky: [234, 88, 12],
  grow: [202, 138, 4],
  shrink: [126, 34, 206],
  solid: MARKER.black,
  goal: MARKER.green,
  hazard: MARKER.red,
  spawn: MARKER.blue,
};

export const rgbCss = ([red, green, blue]: Rgb, alpha = 1): string =>
  `rgba(${red}, ${green}, ${blue}, ${alpha})`;

export const BOARD_COLORS = {
  board: "#ffffff",
  gridDot: "#d6d6dc",
  marker: rgbCss(MARKER.black),
  hatch: "#a9a9ad",
  glassEdge: "#8ec5ee",
  glassFill: "rgba(142, 197, 238, 0.14)",
  noInk: "#e76a6a",
  eraserRing: rgbCss(MARKER.black, 0.6),
  eraserVeil: "rgba(255, 255, 255, 0.45)",
} as const;

const NOTE_CSS: Readonly<Record<NoteAuthor | Exclude<NoteTone, "plain">, string>> = {
  player: rgbCss(MARKER.black),
  kami: rgbCss(MARKER.blue),
  understood: rgbCss(MARKER.green),
  confused: rgbCss(MARKER.red),
};

export const noteCss = (author: NoteAuthor, tone: NoteTone): string =>
  NOTE_CSS[tone === "plain" ? author : tone];

export const mixRgb = (from: Rgb, to: Rgb, amount: number): Rgb => [
  Math.round(from[0] + (to[0] - from[0]) * amount),
  Math.round(from[1] + (to[1] - from[1]) * amount),
  Math.round(from[2] + (to[2] - from[2]) * amount),
];

export const mapNatures = <T>(toValue: (nature: Nature) => T): Readonly<Record<Nature, T>> =>
  Object.fromEntries(NATURES.map((nature) => [nature, toValue(nature)])) as Record<Nature, T>;
