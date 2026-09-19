import type { Vec } from "../core/geometry";
import type { DrawingId } from "../ink/types";

export type NoteId = string & { readonly __brand: "NoteId" };

export type NoteAuthor = "player" | "kami";

/** How a note reads at a glance: plain ink, a rule or name Kami understood, or one he didn't. */
export type NoteTone = "plain" | "understood" | "confused";

/** Tapping a note that carries an action performs it — Kami's guesses are offered this way. */
export type NoteAction = {
  readonly type: "name-drawing";
  readonly drawingId: DrawingId;
  readonly name: string;
};

/** Anything written on the board, by the player or by Kami. Always rendered as pen strokes. */
export interface Note {
  readonly id: NoteId;
  readonly author: NoteAuthor;
  readonly text: string;
  /** Top-left of the first line, in world space. */
  readonly position: Vec;
  readonly tone: NoteTone;
  readonly createdAt: number;
  readonly action?: NoteAction;
  /** Deletion association for a drawing's label, independent of its position. */
  readonly drawingId?: DrawingId;
  /** Kami's passing remarks fade; rules, names and the player's own notes stay. */
  readonly fleeting: boolean;
}
