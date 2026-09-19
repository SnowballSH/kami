import type { Stroke, Vec } from "../core/geometry";
import type { Completion } from "./types";

const isPoint = (value: unknown): value is Vec =>
  typeof value === "object" &&
  value !== null &&
  "x" in value &&
  "y" in value &&
  Number.isFinite(value.x) &&
  Number.isFinite(value.y);

const isStroke = (value: unknown): value is Stroke => Array.isArray(value) && value.every(isPoint);

const hasInk = (strokes: readonly Stroke[]): boolean => strokes.some((stroke) => stroke.length > 0);

/** The completion service's answer; null for an image, an older server, or anything else unexpected. */
export const completionOf = (body: unknown): Completion | null => {
  if (typeof body !== "object" || body === null) return null;
  const { strokes, category, confidence } = body as Record<string, unknown>;
  if (!Array.isArray(strokes) || !strokes.every(isStroke) || !hasInk(strokes)) return null;
  return {
    strokes: strokes.map((stroke) => stroke.map(({ x, y }) => ({ x, y }))),
    word: typeof category === "string" ? category : "",
    confidence: typeof confidence === "number" && Number.isFinite(confidence) ? confidence : 0,
  };
};
