import type { Vec } from "../core/geometry";
import type { NoteId } from "../notes/types";

export type RuleId = string & { readonly __brand: "RuleId" };

/**
 * A drawing's own physics, over and above its nature: `spin` in turns per second (positive is
 * clockwise on screen), `thrust` a steady push on itself in g, `mass` and `grip` multiply its own
 * weight and surface friction, `bounce` is how much of a fall it gives back (0 to 1).
 */
export interface Motion {
  readonly spin: number;
  readonly thrust: Vec;
  readonly mass: number;
  readonly bounce: number;
  readonly grip: number;
}

export type MotionEdit = Partial<Motion>;

export type BodyGoverns = keyof Motion;

/** Which drawings a law about bodies speaks of: every loose one, or those named with a word. */
export type Target = { readonly kind: "all" } | { readonly kind: "named"; readonly name: string };

/**
 * What a rule changes about the world: one dial, set to one value (see docs/laws.md).
 * Dials on the world: gravity and wind are in g (1 = Earth, +y is down); `timeScale`, `airDrag`,
 * `friction` and `bounciness` are multipliers or ratios; `temperature` is in °C and `daylight` is 0
 * (midnight) to 1 (noon). Dials on Alice: `flight` is 0 or 1, `walkSpeed` and `aliceSize` multiply
 * her own, `attraction` is the pull she exerts on ink in g, `clones` is how many copies of her walk
 * beside her. Dials on what haunts the board: `inkEater` is 0 (sealed) or 1 (the Sumikui is loose).
 */
export type WorldEffect =
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
  | { readonly governs: "clones"; readonly value: number }
  | { readonly governs: "inkEater"; readonly value: number };

/** A dial on the bodies a `Target` names, in the units of `Motion`. */
export type BodyEffect =
  | { readonly governs: "thrust"; readonly of: Target; readonly x: number; readonly y: number }
  | {
      readonly governs: Exclude<BodyGoverns, "thrust">;
      readonly of: Target;
      readonly value: number;
    };

export type RuleEffect = WorldEffect | BodyEffect;

export type WorldGoverns = WorldEffect["governs"];

export type Governs = RuleEffect["governs"];

export const isBodyEffect = (effect: RuleEffect): effect is BodyEffect => "of" in effect;

/** One standing law about bodies, in the order it was written; later laws win dial by dial. */
export interface BodyLaw {
  readonly of: Target;
  readonly edit: MotionEdit;
}

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

/**
 * Every dial of the board — world and Alice — once every standing rule is applied, and the laws
 * about bodies, oldest first, for the simulation to resolve against each drawing's name.
 */
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
  readonly inkEater: number;
  readonly bodies: readonly BodyLaw[];
}

export const STILL: Motion = { spin: 0, thrust: { x: 0, y: 0 }, mass: 1, bounce: 0, grip: 1 };

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
  inkEater: 0,
  bodies: [],
};
