import { z } from "zod";
import { NATURES, type Ruling, STRENGTH_RANGE } from "../cat/types";
import type { Stroke, Vec } from "../core/geometry";
import type { Drawing, DrawingId } from "../ink/types";
import type { Note, NoteAction, NoteId } from "../notes/types";
import { validEffect } from "../rules/effectDomains";
import type { CompiledRule, Rule, RuleEffect, RuleId } from "../rules/types";
import type { BoardSnapshot, BoardSummary, StoredDrawing } from "./types";

const MAX_ID_LENGTH = 200;
const MAX_TEXT_LENGTH = 4000;
const MAX_STROKES = 2000;
const MAX_POINTS_PER_STROKE = 20000;

const isId = (value: unknown): boolean =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;

const brandedId = <Id extends string>() => z.custom<Id>(isId, "expected a non-empty id");

export const textSchema = z.string().max(MAX_TEXT_LENGTH);

const text = textSchema;

export const boardIdSchema = z.string().min(1).max(MAX_ID_LENGTH);

export const entityIdSchema = z.string().min(1).max(MAX_ID_LENGTH);

export const vecSchema = z.object({ x: z.number(), y: z.number() }) satisfies z.ZodType<Vec>;

export const strokeSchema = z
  .array(vecSchema)
  .max(MAX_POINTS_PER_STROKE) satisfies z.ZodType<Stroke>;

export const strokesSchema = z.array(strokeSchema).max(MAX_STROKES);

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
  ruling: rulingSchema.exactOptional(),
}) satisfies z.ZodType<NoteAction>;

export const noteSchema = z.looseObject({
  id: brandedId<NoteId>(),
  author: z.enum(["player", "kami"]),
  text,
  position: vecSchema,
  tone: z.enum(["plain", "understood", "confused"]),
  createdAt: z.number(),
  action: noteActionSchema.exactOptional(),
  drawingId: brandedId<DrawingId>().exactOptional(),
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

const uniqueIds = (ids: readonly string[]): boolean => new Set(ids).size === ids.length;

export const boardSnapshotSchema = z.object({
  drawings: z
    .array(storedDrawingSchema)
    .refine(
      (entries) => uniqueIds(entries.map(({ drawing }) => drawing.id)),
      "duplicate drawing id",
    ),
  notes: z
    .array(noteSchema)
    .refine((entries) => uniqueIds(entries.map(({ id }) => id)), "duplicate note id"),
  rules: z
    .array(ruleSchema)
    .refine((entries) => uniqueIds(entries.map(({ id }) => id)), "duplicate rule id"),
}) satisfies z.ZodType<BoardSnapshot>;

export const boardSummarySchema = z.object({
  id: boardIdSchema,
  drawings: z.number().int().nonnegative(),
  rules: z.number().int().nonnegative(),
}) satisfies z.ZodType<BoardSummary>;

export const boardSummaryListSchema = z.object({ boards: z.array(boardSummarySchema) });
