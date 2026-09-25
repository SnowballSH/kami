import type { PenPoint, Vec } from "../core/geometry";
import type { ModeCard, RoomCard } from "../modes/types";
import type { PersistenceState } from "../persistence/types";
import type { RuleId } from "../rules/types";
import type { WalkIntent } from "../sim/types";

export type Tool = "draw" | "write" | "erase" | "pan";

export interface BoardListing {
  readonly id: string;
  readonly title: string;
}

/** What another device needs to join this page, and how many already have. */
export interface ShareInfo {
  readonly boardId: string;
  /** `?board=<id>&mode=<mode>` on this very origin. */
  readonly link: string;
  readonly company: number;
}

export interface HudHandlers {
  onWalkIntent(intent: WalkIntent): void;
  onToolChanged(tool: Tool): void;
  /** A zoom button: multiply the zoom by `factor` about the centre of the screen. */
  onZoom(factor: number): void;
  /** Bring Alice back to the middle of the screen. */
  onRecenter(): void;
  /** Alice walks herself, or waits for the thumbstick and the arrow keys. */
  onAutopilotToggled(enabled: boolean): void;
  /** The tidy slider moved: 0 leaves the ink alone, 1 is as firm as Kami gets. */
  onTidinessChanged(tidiness: number): void;
  onOpenBoard(boardId: string): void;
  onNewBoard(): void;
  /** Wipe everything the player drew, wrote and ruled on this board. */
  onClearBoard(): void;
  onRetryPersistence(): void;
}

export interface Hud {
  toolbarBottom(): number;
  setTool(tool: Tool): void;
  setAutopilot(enabled: boolean): void;
  setTidiness(tidiness: number): void;
  setBoards(boards: readonly BoardListing[], currentId: string): void;
  setPersistence(state: PersistenceState): void;
  /** The title card of a staged room, fading on its own; `null` clears it and its progress mark. */
  showRoomCard(card: RoomCard | null): void;
  /**
   * An inline field at `client` (CSS px) to write a note into — typed, or handwritten with
   * Apple Pencil Scribble. Resolves with the trimmed text, or null if abandoned or empty.
   */
  promptText(client: Vec): Promise<string | null>;
  /** The share affordance for a shared page; null hides it. */
  setShare(share: ShareInfo | null): void;
  /** The mode's name and one line over the page for a moment. */
  showTitleCard(card: ModeCard): void;
}

export interface LawListing {
  readonly id: RuleId;
  /** The law as the player wrote it. */
  readonly text: string;
  /** Kami's reading of it, as glossed under the note. */
  readonly gloss: string;
}

export interface LawsPanelHandlers {
  onRepealLaw(id: RuleId): void;
}

/** The standing laws, always on screen and each one tappable to repeal, long after the notes fade. */
export interface LawsPanel {
  setLaws(laws: readonly LawListing[]): void;
}

/**
 * What the canvas reports, in client (CSS px) coordinates. The HUD's current tool decides
 * what a one-finger drag means; two fingers always pan and pinch; the wheel pans, and
 * pinch-wheel / ctrl-wheel zooms.
 */
export interface CanvasInputSink {
  penDown(client: PenPoint): void;
  penMove(client: PenPoint): void;
  penUp(): void;
  /** The stroke turned out not to be one: a second finger landed, or it never moved. */
  penCancel(): void;
  /** A press and release without travel, with any tool. Follows `penCancel` when a pen was down. */
  tap(client: Vec): void;
  panBy(deltaClient: Vec): void;
  zoomAt(client: Vec, factor: number): void;
}

export type Detach = () => void;
