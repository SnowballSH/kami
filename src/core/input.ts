import { z } from "zod";
import type { Stroke, Vec } from "./geometry";
import { INPUT_LIMITS, strokeBudgetIssue } from "./inputLimits";

const coordinate = z.number().min(-INPUT_LIMITS.coordinate).max(INPUT_LIMITS.coordinate);

export const vecSchema = z.object({ x: coordinate, y: coordinate }) satisfies z.ZodType<Vec>;
export const textSchema = z.string().max(INPUT_LIMITS.text);
export const strokeSchema = z
  .array(vecSchema)
  .max(INPUT_LIMITS.pointsPerStroke) satisfies z.ZodType<Stroke>;

export const strokesSchema = z.preprocess((value, context) => {
  if (!Array.isArray(value)) return value;
  const strokes: readonly unknown[] = value;
  const issue = strokeBudgetIssue(strokes);
  if (issue !== null) {
    context.addIssue({ code: "custom", message: issue });
    return z.NEVER;
  }
  return value;
}, z.array(strokeSchema).max(INPUT_LIMITS.strokes));
