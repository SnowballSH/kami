import type { BoardDefinition, PageKind } from "../board/types";
import type { AllowedNatures, Ruling } from "../cat/types";
import type { DrawingId } from "../ink/types";
import type { Governs, WorldPhysics } from "../rules/types";
import type { SimEvent } from "../sim/types";

export type GameModeId = string & { readonly __brand: "GameModeId" };

/**
 * How a spirit comes to have a body. `born`: Alice stands at the spawn from the first frame.
 * `drawn`: the player sketches her and names the sketch one of `names`; that drawing becomes her,
 * its strokes her body.
 */
export type Incarnation =
  | { readonly kind: "born" }
  | { readonly kind: "drawn"; readonly names: readonly string[] };

/**
 * What the player is when the room opens. With a `body` the player is Alice — steering her or
 * watching her walk herself — and she stands at the spawn. A `spirit` has no body: the player is
 * only a hand that draws and writes, and nobody is on the board until the incarnation happens.
 */
export type Opening =
  | { readonly player: "body"; readonly freshPage: boolean }
  | { readonly player: "spirit"; readonly incarnation: Incarnation; readonly freshPage: boolean };

/**
 * `reach-goal` is the rabbit hole or a drawing named goal; `endless` never ends; `outlast` is
 * surviving that long; `defeat-foe` is closing the tear a servant of the one under the page came through.
 */
export type WinRule =
  | { readonly kind: "reach-goal" }
  | { readonly kind: "endless" }
  | { readonly kind: "outlast"; readonly ms: number }
  | { readonly kind: "defeat-foe" };

/**
 * What losing her body means. `respawn`: she is set down at her checkpoint. `unmade`: the body is
 * gone and the player is a spirit again until they draw her anew. `board-restarts`: the room opens over.
 */
export type LossRule =
  | { readonly kind: "respawn" }
  | { readonly kind: "unmade" }
  | { readonly kind: "board-restarts" };

/** Which dials written laws may turn in this mode. */
export type LawPolicy =
  | { readonly kind: "all" }
  | { readonly kind: "only"; readonly dials: readonly Governs[] }
  | { readonly kind: "except"; readonly dials: readonly Governs[] };

/** Narrows the board's own `RoomBrief.allowedNatures`; never widens it. */
export type NaturePolicy = AllowedNatures;

/**
 * When Kami helps unasked. `offered`: the stuck detector climbs the hint ladder when she has made
 * no progress for a while. `on-request`: he only answers when the player writes for help.
 */
export type HelpPolicy = "offered" | "on-request";

/**
 * Whether the board is played alone or with everyone who has it open. `live`: other devices' ink,
 * notes and laws arrive as they happen, and their Alices walk the page as ghosts.
 */
export type SharingPolicy = "alone" | "live";

/**
 * What the top-left cluster offers besides home. `boards`: the board menu (or Share on a shared
 * page). `run`: a staged run of rooms, which offers only a way to start the run over.
 */
export type MenuPolicy =
  | { readonly kind: "boards" }
  | { readonly kind: "run"; readonly firstBoardId: string };

/** What the title card and Kami say about the mode. */
export interface ModeCard {
  readonly title: string;
  readonly tagline: string;
  /** Kami's first line when a room opens in this mode. */
  readonly opening: string;
  /** One line per player when the mode is for more than one pair of hands. */
  readonly roles?: readonly string[];
  /** The title card shown when a loss reopens the room. */
  readonly again?: {
    readonly title: string;
    readonly tagline: string;
  };
  readonly won?: {
    readonly title: string;
    readonly tagline: string;
  };
}

/**
 * A way to play a board. Modes are data: the game reads one and behaves accordingly, so a new mode
 * is a new constant, not new code, until it needs an `Incarnation` or `LossRule` nobody has built.
 */
export interface GameMode {
  readonly id: GameModeId;
  readonly card: ModeCard;
  readonly opening: Opening;
  readonly win: WinRule;
  readonly loss: LossRule;
  readonly laws: LawPolicy;
  readonly natures: NaturePolicy;
  /** Whether she may walk herself; a spirit's drawn Alice may be meant to be steered by hand. */
  readonly autopilot: "allowed" | "forbidden";
  /** How the board id is read: as the room sketched under it, or as an endless page. */
  readonly page: PageKind;
  readonly help: HelpPolicy;
  readonly sharing: SharingPolicy;
  readonly menu: MenuPolicy;
  /** What Kami says instead of the stock refusal when a law turns a dial this mode forbids. */
  readonly refusals?: Readonly<Partial<Record<Governs, string>>>;
}

/** What the player is right now, as opposed to at the opening. */
export type PlayerState =
  | { readonly kind: "body" }
  | { readonly kind: "spirit"; readonly incarnation: Incarnation };

/** A change of body, reported by the director for the game to enact and Kami to remark on. */
export type EmbodimentTransition =
  | { readonly kind: "incarnated"; readonly by: "spawn" }
  | {
      readonly kind: "incarnated";
      readonly by: "drawing";
      readonly drawingId: DrawingId;
      readonly name: string;
    }
  | { readonly kind: "unmade"; readonly cause: "fell" | "devoured" | "swallowed" }
  | { readonly kind: "tear-opens" };

/** The title card shown as a staged room opens. */
export interface RoomCard {
  readonly mode: string;
  readonly title: string;
  /** Kami's one line for the room: riddle, not instructions. */
  readonly line: string;
  /** Where the room sits in its run ("room 2 of 7"); stays in the HUD after the card fades. */
  readonly mark: string | null;
}

/**
 * How a mode stages the board it has open, when it plays rooms differently from one another: the
 * world as the room lays it down before anyone writes (written laws fold over it), the dials the
 * room will take, its card, Kami's quiet line when it is won, and the board that opens after it.
 */
export interface RoomStaging {
  readonly world: WorldPhysics;
  readonly laws: LawPolicy;
  readonly card: RoomCard;
  readonly closing: string;
  /** `null` when the run ends here. */
  readonly next: string | null;
}

/**
 * The mode's referee for one open room. The game calls it at the seams where a mode could differ —
 * opening, every sim event, every naming — and enacts whatever transitions it returns. It holds
 * the player's state; the game does not.
 */
export interface ModeDirector {
  readonly mode: GameMode;
  readonly state: PlayerState;
  readonly bodyNames: readonly string[];
  /** How the open board is staged; `null` when the mode plays the board as it is, under `mode.laws` over EARTH. */
  readonly room: RoomStaging | null;
  /** The board is loaded and nothing has stepped yet. */
  open(board: BoardDefinition): PlayerState;
  witness(event: SimEvent): readonly EmbodimentTransition[];
  /** A drawing was named. In a spirit room this is where she may be drawn into being. */
  named(drawingId: DrawingId, ruling: Ruling): readonly EmbodimentTransition[];
  /** True when the room has been won under this mode's `WinRule`. */
  won(event: SimEvent): boolean;
  close(): void;
}
