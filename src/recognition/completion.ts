import { z } from "zod";
import type { Stroke } from "../core/geometry";
import { strokesSchema } from "../core/input";
import { INPUT_LIMITS, isInputStrokes } from "../core/inputLimits";
import type { Completion } from "./types";

const answerSchema = z.object({
  tidied: strokesSchema,
  added: strokesSchema,
  category: z.string().max(INPUT_LIMITS.name).catch(""),
  confidence: z.number().catch(0),
});

const hasInk = (strokes: readonly Stroke[]): boolean => strokes.some((stroke) => stroke.length > 0);

const sameShape = (tidied: readonly Stroke[], drawn: readonly Stroke[]): boolean =>
  tidied.length === drawn.length &&
  tidied.every((stroke, index) => stroke.length === drawn[index]?.length);

/** Each tidied point keeps the pressure the pen had there, so the line keeps its thick and thin. */
const withPressureOf = (drawn: readonly Stroke[], tidied: readonly Stroke[]): readonly Stroke[] =>
  tidied.map((stroke, at) =>
    stroke.map((point, index) => {
      const pressure = drawn[at]?.[index]?.pressure;
      return pressure === undefined ? point : { ...point, pressure };
    }),
  );

/**
 * The completion service's answer for the strokes that were `drawn`; null for an image, an older
 * server, a tidied drawing that is not point for point the player's, or anything else unexpected.
 */
export const completionOf = (body: unknown, drawn: readonly Stroke[]): Completion | null => {
  const parsed = answerSchema.safeParse(body);
  if (!parsed.success) return null;
  const { tidied, added, category, confidence } = parsed.data;
  if (!isInputStrokes([...tidied, ...added])) return null;
  if (!hasInk(tidied) || !sameShape(tidied, drawn)) return null;
  return {
    tidied: withPressureOf(drawn, tidied),
    added: added.filter((stroke) => stroke.length > 1),
    word: category,
    confidence,
  };
};
