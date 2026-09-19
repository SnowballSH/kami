import type { Vec } from "../core/geometry";
import type { NoteId } from "../notes/types";

export type RuleId = string & { readonly __brand: "RuleId" };

/**
 * What a rule changes about the world: one dial, set to one value (see docs/laws.md).
 * Dials on the world: gravity and wind are in g (1 = Earth, +y is down); `timeScale`, `airDrag`,
 * `friction` and `bounciness` are multipliers or ratios; `temperature` is in °C and `daylight` is 0
 * (midnight) to 1 (noon). Dials on Alice: `flight` is 0 or 1, `walkSpeed` and `aliceSize` multiply
 * her own, `attraction` is the pull she exerts on ink in g, `clones` is how many copies of her walk
 * beside her.
 */
export type RuleEffect =
  | { readonly governs: "gravity"; readonly x: number; readonly y: number }
  | { readonly governs: "wind"; readonly x: number; readonly y: number }
  | { readonly governs: "timeScale"; readonly value: number }
  | { readonly governs: "airDrag"; readonly value: number }
  | { readonly governs: "friction"; readonly value: number }
  | { readonly governs: "bounciness"; readonly value: number }
  | { readonly governs: "temperature"; readonly value: number }
  | { readonly governs: "daylight"; readonly value: number }
  | { readonly governs: "flight"; readonly value: number }
  | { readonly governs: "walkSpeed"; readonly value: number }
  | { readonly governs: "aliceSize"; readonly value: number }
  | { readonly governs: "attraction"; readonly value: number }
  | { readonly governs: "clones"; readonly value: number };

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

/** Every dial of the board — world and Alice — once every standing rule is applied. */
export interface WorldPhysics {
  readonly gravity: Vec;
  readonly wind: Vec;
  readonly timeScale: number;
  readonly airDrag: number;
  readonly friction: number;
  readonly bounciness: number;
  readonly temperature: number;
  readonly daylight: number;
  readonly flight: number;
  readonly walkSpeed: number;
  readonly aliceSize: number;
  readonly attraction: number;
  readonly clones: number;
}

export const EARTH: WorldPhysics = {
  gravity: { x: 0, y: 1 },
  wind: { x: 0, y: 0 },
  timeScale: 1,
  airDrag: 1,
  friction: 1,
  bounciness: 0,
  temperature: 20,
  daylight: 1,
  flight: 0,
  walkSpeed: 1,
  aliceSize: 1,
  attraction: 0,
  clones: 0,
};
