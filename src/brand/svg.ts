import { getStroke, type StrokeOptions } from "perfect-freehand";
import type { Rect, Stroke, Vec } from "../core/geometry";
import { MARKER, rgbCss } from "../render/palette";

export const INK = rgbCss(MARKER.black);
export const PAPER = "#ffffff";

const DECIMALS = 2;

const LOGO_PEN: StrokeOptions = {
  thinning: 0.4,
  smoothing: 0.5,
  streamline: 0.2,
  simulatePressure: true,
  last: true,
};

export const round = (value: number): string => value.toFixed(DECIMALS).replace(/\.?0+$/, "");

export const line = (from: Vec, to: Vec): string =>
  `M${round(from.x)} ${round(from.y)}L${round(to.x)} ${round(to.y)}`;

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

const viewBox = ({ x, y, width, height }: Rect): string =>
  [x, y, width, height].map(round).join(" ");

export const svgDocument = (box: Rect, body: string, title: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox(box)}" role="img" aria-label="${title}">${body}</svg>\n`;

export const svgBody = (document: string): string =>
  document.replace(/^<svg[^>]*>|<\/svg>\n$/g, "");
