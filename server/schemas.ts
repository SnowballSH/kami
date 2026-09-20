import { z } from "zod";
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

const MAX_NAME_LENGTH = 80;

export const beautifyRequestSchema = z.object({
  strokes: strokesSchema,
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH).exactOptional(),
});

export const compileRequestSchema = z.object({ text: textSchema.min(1) });

export const transcribeRequestSchema = z.object({ strokes: strokesSchema.min(1) });

const MAX_SPOKEN_LENGTH = 400;

export const speakRequestSchema = z.object({ text: textSchema.min(1).max(MAX_SPOKEN_LENGTH) });
