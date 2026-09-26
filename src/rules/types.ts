import type { Vec } from "../core/geometry";
import type { NoteId } from "../notes/types";

export type RuleId = string & { readonly __brand: "RuleId" };

/**
 * A drawing's own physics, over and above its nature: `spin` in turns per second (positive is
 * clockwise on screen), `thrust` a steady push on itself in g, `mass` and `grip` multiply its own
 * weight and surface friction, `bounce` is how much of a fall it gives back (0 to 1). Its powers:
 * `pace` multiplies how fast it moves of itself (a creature's walk, hop, flight or driving),
 * `wings` (0 or 1) lets it take to the air — a creature moves as a flier, anything else hovers —
 * and `size` scales it about its own centre (1 = as drawn). `heed` is how a creature takes to
 * Alice: 1 follows her, -1 flees her, 0 goes its own way. `glow` (0 or 1) makes it carry a lantern's
 * pool of light wherever it goes, whatever its nature.
 */
export interface Motion {
  readonly spin: number;
  readonly thrust: Vec;
  readonly mass: number;
  readonly bounce: number;
  readonly grip: number;
  readonly pace: number;
  readonly wings: number;
  readonly size: number;
  readonly heed: number;
  readonly glow: number;
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
 * Dials on the paper itself: `tilt` is how far the whole page is turned on screen in degrees
 * (clockwise positive) and `worldSpin` how fast it keeps turning in degrees per second; the board
 * is of the paper and turns with it, loose ink tumbles toward the room's down.
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
  | { readonly governs: "inkEater"; readonly value: number }
  | { readonly governs: "tilt"; readonly value: number }
  | { readonly governs: "worldSpin"; readonly value: number };

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
  /** Set on the laws a journey brought ("the Moon"); the next journey repeals them all. */
  readonly scene?: string;
}

/**
 * Where a note was written, as far as reading it goes: the named drawing it sits beside, which a
 * pronoun in it ("it drifts to the right", "they float") stands for. See docs/laws.md §2.1.
 */
export interface CompileContext {
  /** One lowercase noun, the head of the drawing's name: "boat" for "a little red boat". */
  readonly referent: string;
}

/** Null means "this text is not a rule" — never an error. */
export interface RuleCompiler {
  compile(text: string, context?: CompileContext): Promise<CompiledRule | null>;
}

/** Something Kami draws to dress a place: a word he has a picture of, and where it goes. */
export interface Prop {
  readonly word: string;
  /** The prop's centre, from the top-centre of the words that asked, in world px (y down). */
  readonly at: Vec;
  /** Its longer side, as a multiple of a summoned drawing's size. */
  readonly size: number;
}

/**
 * A place, as the laws that make it behave like itself and the props that make it look the part.
 * "Teleport us to the moon" is a bundle of dial sets (docs/laws.md §2.2), all bound to the one
 * note, so erasing the note brings everyone home; the props are ordinary ink and stay.
 */
export interface Scene {
  /** As Kami names it in the gloss, e.g. "the Moon". */
  readonly place: string;
  readonly laws: readonly CompiledRule[];
  readonly props: readonly Prop[];
  /** What Kami says on arrival. */
  readonly line: string;
}

/** Null means "this text does not ask to go anywhere" — never an error. */
export interface SceneCompiler {
  compile(text: string): Promise<Scene | null>;
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
  readonly tilt: number;
  readonly worldSpin: number;
  readonly bodies: readonly BodyLaw[];
}

export const STILL: Motion = {
  spin: 0,
  thrust: { x: 0, y: 0 },
  mass: 1,
  bounce: 0,
  grip: 1,
  pace: 1,
  wings: 0,
  size: 1,
  heed: 0,
  glow: 0,
};

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
  tilt: 0,
  worldSpin: 0,
  bodies: [],
};
