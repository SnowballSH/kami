import { z } from "zod";
import type { PenPoint, Stroke, Vec } from "./geometry";
import { INPUT_LIMITS, strokeBudgetIssue } from "./inputLimits";

const coordinate = z.number().min(-INPUT_LIMITS.coordinate).max(INPUT_LIMITS.coordinate);

export const vecSchema = z.object({ x: coordinate, y: coordinate }) satisfies z.ZodType<Vec>;
export const penPointSchema = vecSchema.extend({
  pressure: z.number().min(0).max(1).exactOptional(),
}) satisfies z.ZodType<PenPoint>;
export const textSchema = z.string().max(INPUT_LIMITS.text);

const strokeOf = <Point extends z.ZodType<Vec>>(point: Point) =>
  z.array(point).max(INPUT_LIMITS.pointsPerStroke);

const strokesOf = <Point extends z.ZodType<Vec>>(point: Point) =>
  z.preprocess(
    (value, context) => {
      if (!Array.isArray(value)) return value;
      const strokes: readonly unknown[] = value;
      const issue = strokeBudgetIssue(strokes);
      if (issue !== null) {
        context.addIssue({ code: "custom", message: issue });
        return z.NEVER;
      }
      return value;
    },
    z.array(strokeOf(point)).max(INPUT_LIMITS.strokes),
  );

/** Strokes as geometry: what recognition, tidying and transcription read. The pen's pressure is dropped. */
export const strokeSchema = strokeOf(vecSchema) satisfies z.ZodType<Stroke>;
export const strokesSchema = strokesOf(vecSchema) satisfies z.ZodType<readonly Stroke[]>;

/** Strokes as ink: what a drawing keeps, so a pen's thick and thin survive a reload and reach other devices. */
export const penStrokesSchema = strokesOf(penPointSchema) satisfies z.ZodType<readonly Stroke[]>;
