import { z } from "zod";
import { NATURES, type Ruling, STRENGTH_RANGE } from "../src/cat/types";
import { strokesSchema, textSchema, vecSchema } from "../src/core/input";
import { INPUT_LIMITS } from "../src/core/inputLimits";
import type { Drawing, DrawingId } from "../src/ink/types";
import type { Note, NoteAction, NoteId } from "../src/notes/types";
import type { StoredDrawing } from "../src/persistence/types";
import { validEffect } from "../src/rules/effectDomains";
import type { CompiledRule, Rule, RuleEffect, RuleId } from "../src/rules/types";

const MAX_ID_LENGTH = 200;

export { strokeSchema, strokesSchema, vecSchema } from "../src/core/input";

const isId = (value: unknown): boolean =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;

const brandedId = <Id extends string>() => z.custom<Id>(isId, "expected a non-empty id");

const text = textSchema;

export const boardIdSchema = z.string().min(1).max(MAX_ID_LENGTH);

export const entityIdSchema = z.string().min(1).max(MAX_ID_LENGTH);

export const drawingSchema = z.looseObject({
  id: brandedId<DrawingId>(),
  strokes: strokesSchema,
  cost: z.number().nonnegative(),
}) satisfies z.ZodType<Drawing>;

export const rulingSchema = z.looseObject({
  name: text,
  nature: z.enum(NATURES),
  strength: z.number().min(STRENGTH_RANGE.min).max(STRENGTH_RANGE.max),
  tags: z.array(text),
  line: text,
}) satisfies z.ZodType<Ruling>;

export const storedDrawingSchema = z.looseObject({
  drawing: drawingSchema,
  ruling: rulingSchema.nullable(),
}) satisfies z.ZodType<StoredDrawing>;

const noteActionSchema = z.looseObject({
  type: z.literal("name-drawing"),
  drawingId: brandedId<DrawingId>(),
  name: text,
}) satisfies z.ZodType<NoteAction>;

export const noteSchema = z.looseObject({
  id: brandedId<NoteId>(),
  author: z.enum(["player", "kami"]),
  text,
  position: vecSchema,
  tone: z.enum(["plain", "understood", "confused"]),
  createdAt: z.number(),
  action: noteActionSchema.exactOptional(),
  fleeting: z.boolean(),
}) satisfies z.ZodType<Note>;

const vectorEffect = <Governs extends "gravity" | "wind">(governs: Governs) =>
  z.object({ governs: z.literal(governs), x: z.number(), y: z.number() });

const scalarEffect = <
  Governs extends
    | "timeScale"
    | "airDrag"
    | "friction"
    | "bounciness"
    | "temperature"
    | "daylight"
    | "flight"
    | "walkSpeed"
    | "aliceSize"
    | "attraction"
    | "clones"
    | "inkEater",
>(
  governs: Governs,
) => z.object({ governs: z.literal(governs), value: z.number() });

export const rawRuleEffectSchema = z.discriminatedUnion("governs", [
  vectorEffect("gravity"),
  vectorEffect("wind"),
  scalarEffect("timeScale"),
  scalarEffect("airDrag"),
  scalarEffect("friction"),
  scalarEffect("bounciness"),
  scalarEffect("temperature"),
  scalarEffect("daylight"),
  scalarEffect("flight"),
  scalarEffect("walkSpeed"),
  scalarEffect("aliceSize"),
  scalarEffect("attraction"),
  scalarEffect("clones"),
  scalarEffect("inkEater"),
]) satisfies z.ZodType<RuleEffect>;

export const ruleEffectSchema = rawRuleEffectSchema.refine(validEffect, {
  message: "effect is outside its supported domain",
});

export const compiledRuleSchema = z.object({
  effect: ruleEffectSchema,
  explanation: text,
}) satisfies z.ZodType<CompiledRule>;

export const ruleSchema = z.looseObject({
  id: brandedId<RuleId>(),
  effect: ruleEffectSchema,
  explanation: text,
  sourceText: text,
  noteId: brandedId<NoteId>(),
  position: vecSchema,
  createdAt: z.number(),
}) satisfies z.ZodType<Rule>;

/** `partial` marks a drawing still under the pen: a live guess, asked for many times a second. */
export const recognizeRequestSchema = z.object({
  strokes: strokesSchema,
  partial: z.boolean().optional(),
});

export const beautifyRequestSchema = z.object({
  strokes: strokesSchema,
  name: z.string().trim().min(1).max(INPUT_LIMITS.name).exactOptional(),
});

export const compileRequestSchema = z.object({ text: text.min(1) });

export const transcribeRequestSchema = z.object({
  strokes: strokesSchema.refine((strokes) => strokes.length > 0, "expected at least one stroke"),
});
