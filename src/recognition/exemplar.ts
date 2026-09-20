import type { Stroke, Vec } from "../core/geometry";
import type { Exemplar } from "./types";

export const EXEMPLAR_BOX = 256;

const isPoint = (value: unknown): value is Vec =>
  typeof value === "object" &&
  value !== null &&
  "x" in value &&
  "y" in value &&
  Number.isFinite(value.x) &&
  Number.isFinite(value.y);

const isStroke = (value: unknown): value is Stroke =>
  Array.isArray(value) && value.length > 1 && value.every(isPoint);

const inBox = ({ x, y }: Vec): boolean => x >= 0 && x <= EXEMPLAR_BOX && y >= 0 && y <= EXEMPLAR_BOX;

/** The server's picture of a word; null for anything that is not strokes inside the 256 px frame. */
export const exemplarOf = (body: unknown): Exemplar | null => {
  if (typeof body !== "object" || body === null) return null;
  const { word, strokes } = body as Record<string, unknown>;
  if (typeof word !== "string" || word.trim().length === 0) return null;
  if (!Array.isArray(strokes) || strokes.length === 0 || !strokes.every(isStroke)) return null;
  if (!strokes.every((stroke) => stroke.every(inBox))) return null;
  return { word: word.trim(), strokes: strokes.map((stroke) => stroke.map(({ x, y }) => ({ x, y }))) };
};
