import type { Vec } from "../core/geometry";
import type { NoteId } from "../notes/types";

export type RuleId = string & { readonly __brand: "RuleId" };

/**
 * What a rule changes about the world. One mechanism in this demo — a standing world-scope
 * setting — out of the three in the original design (expression / action / constraint).
 * Gravity and wind are in g (1 = Earth, +y is down); the rest are plain multipliers or ratios.
 */
export type RuleEffect =
  | { readonly governs: "gravity"; readonly x: number; readonly y: number }
  | { readonly governs: "wind"; readonly x: number; readonly y: number }
  | { readonly governs: "timeScale"; readonly value: number }
  | { readonly governs: "airDrag"; readonly value: number }
  | { readonly governs: "friction"; readonly value: number }
  | { readonly governs: "bounciness"; readonly value: number };

export type Governs = RuleEffect["governs"];

/** The output of compiling one piece of text: deterministic, no AI needed to run it. */
export interface CompiledRule {
  readonly effect: RuleEffect;
  /** "Kami understood:" — a short plain gloss, e.g. "gravity = 0.17 g (the Moon)". */
  readonly explanation: string;
}

export interface Rule extends CompiledRule {
  readonly id: RuleId;
  /** Verbatim, whatever register the player wrote it in. */
  readonly sourceText: string;
  /** The note on the board this rule lives in; erasing the note repeals the rule. */
  readonly noteId: NoteId;
  readonly position: Vec;
  readonly createdAt: number;
}

/** Null means "this text is not a rule" — never an error. */
export interface RuleCompiler {
  compile(text: string): Promise<CompiledRule | null>;
}

/** The physics of the whole board once every standing rule is applied. */
export interface WorldPhysics {
  readonly gravity: Vec;
  readonly wind: Vec;
  readonly timeScale: number;
  readonly airDrag: number;
  readonly friction: number;
  readonly bounciness: number;
}

export const EARTH: WorldPhysics = {
  gravity: { x: 0, y: 1 },
  wind: { x: 0, y: 0 },
  timeScale: 1,
  airDrag: 1,
  friction: 1,
  bounciness: 0,
};
