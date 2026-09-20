import { z } from "zod";
import type { DrawingId } from "../ink/types";
import type { Note, NoteId } from "../notes/types";
import {
  entityIdSchema,
  noteSchema,
  ruleSchema,
  storedDrawingSchema,
} from "../persistence/schemas";
import type { StoredDrawing } from "../persistence/types";
import type { Rule, RuleId } from "../rules/types";
import type { AliceSnapshot } from "../sim/types";

export const PEER_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

/** One device on a shared page. Minted per tab; never an account. */
export type PeerId = string & { readonly __brand: "PeerId" };

/** Another device's Alice, as last heard of. */
export type Ghost = AliceSnapshot;

const seqSchema = z.number().int().nonnegative();
export const peerIdSchema = z.string().regex(PEER_ID_PATTERN) as unknown as z.ZodType<PeerId>;

export const ghostSchema: z.ZodType<Ghost> = z.object({
  center: z.object({ x: z.number(), y: z.number() }),
  width: z.number().positive(),
  height: z.number().positive(),
  size: z.enum(["small", "normal", "big"]),
  sizeMultiplier: z.number().positive(),
  headingScale: z.number(),
  facing: z.union([z.literal(-1), z.literal(1)]),
  walking: z.boolean(),
  grounded: z.boolean(),
  climbing: z.boolean(),
  hasKey: z.boolean(),
});

/** `POST /api/boards/:board/presence`: where this device's Alice is right now. */
export const presenceReportSchema = z.object({ peer: peerIdSchema, alice: ghostSchema });
export type PresenceReport = z.infer<typeof presenceReportSchema>;

/** A change to a board, numbered in the order the server saw it. */
export type BoardChange =
  | {
      readonly seq: number;
      readonly type: "put";
      readonly kind: "drawings";
      readonly id: string;
      readonly entity: StoredDrawing;
    }
  | {
      readonly seq: number;
      readonly type: "put";
      readonly kind: "notes";
      readonly id: string;
      readonly entity: Note;
    }
  | {
      readonly seq: number;
      readonly type: "put";
      readonly kind: "rules";
      readonly id: string;
      readonly entity: Rule;
    }
  | {
      readonly seq: number;
      readonly type: "delete";
      readonly kind: "drawings";
      readonly id: DrawingId;
    }
  | { readonly seq: number; readonly type: "delete"; readonly kind: "notes"; readonly id: NoteId }
  | { readonly seq: number; readonly type: "delete"; readonly kind: "rules"; readonly id: RuleId }
  | { readonly seq: number; readonly type: "clear" };

/** A change before the server numbered it. */
export type BoardEdit = BoardChange extends infer Change
  ? Change extends BoardChange
    ? Omit<Change, "seq">
    : never
  : never;

/** Everything `GET /api/boards/:board/events` sends. */
export type FeedMessage =
  | BoardChange
  | { readonly type: "cursor"; readonly seq: number }
  | { readonly type: "resync"; readonly seq: number }
  | { readonly type: "presence"; readonly peer: PeerId; readonly alice: Ghost | null };

const brandedId = <Id extends string>() => entityIdSchema as unknown as z.ZodType<Id>;

/** A deletion by kind and id, as the server hears it: the ids are opaque to it. */
export const deletionOf = (kind: "drawings" | "notes" | "rules", id: string): BoardEdit => {
  switch (kind) {
    case "drawings":
      return { type: "delete", kind, id: id as DrawingId };
    case "notes":
      return { type: "delete", kind, id: id as NoteId };
    case "rules":
      return { type: "delete", kind, id: id as RuleId };
  }
};

export const boardChangeSchema: z.ZodType<BoardChange> = z.discriminatedUnion("type", [
  z.discriminatedUnion("kind", [
    z.object({
      seq: seqSchema,
      type: z.literal("put"),
      kind: z.literal("drawings"),
      id: entityIdSchema,
      entity: storedDrawingSchema,
    }),
    z.object({
      seq: seqSchema,
      type: z.literal("put"),
      kind: z.literal("notes"),
      id: entityIdSchema,
      entity: noteSchema,
    }),
    z.object({
      seq: seqSchema,
      type: z.literal("put"),
      kind: z.literal("rules"),
      id: entityIdSchema,
      entity: ruleSchema,
    }),
  ]),
  z.discriminatedUnion("kind", [
    z.object({
      seq: seqSchema,
      type: z.literal("delete"),
      kind: z.literal("drawings"),
      id: brandedId<DrawingId>(),
    }),
    z.object({
      seq: seqSchema,
      type: z.literal("delete"),
      kind: z.literal("notes"),
      id: brandedId<NoteId>(),
    }),
    z.object({
      seq: seqSchema,
      type: z.literal("delete"),
      kind: z.literal("rules"),
      id: brandedId<RuleId>(),
    }),
  ]),
  z.object({ seq: seqSchema, type: z.literal("clear") }),
]);

export const feedMessageSchema: z.ZodType<FeedMessage> = z.union([
  boardChangeSchema,
  z.object({ type: z.literal("cursor"), seq: seqSchema }),
  z.object({ type: z.literal("resync"), seq: seqSchema }),
  z.object({ type: z.literal("presence"), peer: peerIdSchema, alice: ghostSchema.nullable() }),
]);

export const parseFeedMessage = (data: unknown): FeedMessage | null => {
  if (typeof data !== "string") return null;
  try {
    const parsed = feedMessageSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
