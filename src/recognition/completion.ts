import type { Stroke } from "../core/geometry";
import { strokesSchema } from "../core/input";
import { INPUT_LIMITS, isInputStrokes } from "../core/inputLimits";
import type { Completion } from "./types";

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
  if (typeof body !== "object" || body === null) return null;
  if (!("tidied" in body) || !("added" in body)) return null;
  const tidied = strokesSchema.safeParse(body.tidied);
  const added = strokesSchema.safeParse(body.added);
  if (!tidied.success || !added.success) return null;
  if (!isInputStrokes([...tidied.data, ...added.data])) return null;
  if (!hasInk(tidied.data) || !sameShape(tidied.data, drawn)) return null;
  const category = "category" in body ? body.category : "";
  const confidence = "confidence" in body ? body.confidence : 0;
  return {
    tidied: withPressureOf(drawn, tidied.data),
    added: added.data.filter((stroke) => stroke.length > 1),
    word: typeof category === "string" && category.length <= INPUT_LIMITS.name ? category : "",
    confidence: typeof confidence === "number" && Number.isFinite(confidence) ? confidence : 0,
  };
};
