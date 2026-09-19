import { NATURES, type Nature } from "../cat/types";

export type Rgb = readonly [red: number, green: number, blue: number];

export const FOUNTAIN_BLUE: Rgb = [27, 58, 140];
export const REJECTED_RED: Rgb = [196, 48, 43];

export const NATURE_TINTS: Readonly<Record<Nature, Rgb>> = {
  ink: FOUNTAIN_BLUE,
  bouncy: [226, 84, 144],
  climbable: [44, 128, 72],
  floaty: [70, 158, 224],
  heavy: [62, 70, 86],
  light: [150, 166, 204],
  slippery: [96, 198, 214],
  sticky: [222, 112, 28],
  grow: [204, 152, 20],
  shrink: [132, 72, 192],
};

export const PAGE_COLORS = {
  desk: "#2a2019",
  underPage: "#c9b98f",
  paper: "#f0e2bd",
  paperEdge: "rgba(112, 72, 24, 0.34)",
  foxing: [126, 84, 36],
  printInk: "#1d1a16",
  solidWash: "rgba(70, 48, 22, 0.13)",
  glassFill: "rgba(168, 210, 236, 0.38)",
  glassEdge: "rgba(64, 108, 150, 0.85)",
  noInkRed: "#be2a2a",
  noInkWash: "rgba(190, 42, 42, 0.1)",
  tornEdge: "#fbf4dc",
  holeDark: "#120e0b",
} as const satisfies Record<string, string | Rgb>;

export const PROP_COLORS = {
  keyGold: "#d9a520",
  keyGlow: [255, 214, 92],
  doorWood: "#8a5a2b",
  doorPanel: "rgba(29, 26, 22, 0.55)",
} as const satisfies Record<string, string | Rgb>;

export const ALICE_COLORS = {
  skin: "#f7ecd2",
  hair: "#d9b55a",
  dress: "#c9d3dc",
  apron: "#fbf6e6",
} as const;

export const EFFECT_COLORS = {
  bulletTime: [18, 28, 72],
  eraser: [196, 60, 50],
} as const satisfies Record<string, Rgb>;

export const rgbCss = ([red, green, blue]: Rgb, alpha = 1): string =>
  `rgba(${red}, ${green}, ${blue}, ${alpha})`;

export const mixRgb = (from: Rgb, to: Rgb, amount: number): Rgb => [
  Math.round(from[0] + (to[0] - from[0]) * amount),
  Math.round(from[1] + (to[1] - from[1]) * amount),
  Math.round(from[2] + (to[2] - from[2]) * amount),
];

export const mapNatures = <T>(toValue: (nature: Nature) => T): Readonly<Record<Nature, T>> =>
  Object.fromEntries(NATURES.map((nature) => [nature, toValue(nature)])) as Record<Nature, T>;
