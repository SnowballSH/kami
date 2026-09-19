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

const isStrokeList = (value: unknown): value is readonly Stroke[] =>
  Array.isArray(value) && value.every(isStroke);

const hasInk = (strokes: readonly Stroke[]): boolean => strokes.some((stroke) => stroke.length > 0);

const sameShape = (tidied: readonly Stroke[], drawn: readonly Stroke[]): boolean =>
  tidied.length === drawn.length &&
  tidied.every((stroke, index) => stroke.length === drawn[index]?.length);

const copyOf = (strokes: readonly Stroke[]): readonly Stroke[] =>
  strokes.map((stroke) => stroke.map(({ x, y }) => ({ x, y })));

/**
 * The completion service's answer for the strokes that were `drawn`; null for an image, an older
 * server, a tidied drawing that is not point for point the player's, or anything else unexpected.
 */
export const completionOf = (body: unknown, drawn: readonly Stroke[]): Completion | null => {
  if (typeof body !== "object" || body === null) return null;
  const { tidied, added, category, confidence } = body as Record<string, unknown>;
  if (!isStrokeList(tidied) || !isStrokeList(added)) return null;
  if (!hasInk(tidied) || !sameShape(tidied, drawn)) return null;
  return {
    tidied: copyOf(tidied),
    added: copyOf(added.filter((stroke) => stroke.length > 1)),
    word: typeof category === "string" ? category : "",
    confidence: typeof confidence === "number" && Number.isFinite(confidence) ? confidence : 0,
  };
};
