import { z } from "zod";
import { INPUT_LIMITS } from "../src/core/inputLimits";
import { strokesSchema, textSchema } from "../src/persistence/schemas";

export {
  boardIdSchema,
  compiledRuleSchema,
  drawingSchema,
  entityIdSchema,
  noteSchema,
  rawRuleEffectSchema,
  ruleEffectSchema,
  ruleSchema,
  rulingSchema,
  storedDrawingSchema,
  strokeSchema,
  strokesSchema,
  vecSchema,
} from "../src/persistence/schemas";

/** `partial` marks a drawing still under the pen: a live guess, asked for many times a second. */
export const recognizeRequestSchema = z.object({
  strokes: strokesSchema,
  partial: z.boolean().optional(),
});

export const beautifyRequestSchema = z.object({
  strokes: strokesSchema,
  name: z.string().trim().min(1).max(INPUT_LIMITS.name).exactOptional(),
});

export const compileRequestSchema = z.object({ text: textSchema.min(1) });

export const transcribeRequestSchema = z.object({
  strokes: strokesSchema.refine((strokes) => strokes.length > 0, "expected at least one stroke"),
});
