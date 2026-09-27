import type { BoardDefinition } from "../board/types";
import type { ModeDirector } from "../modes/types";
import type { BoardStore } from "../persistence/types";
import type { Hud } from "../ui/types";
import type { CameraRig } from "./cameraRig";
import type { IdMint } from "./idMint";
import type { InkLedger } from "./inkLedger";
import type { GameModules } from "./modules";
import type { NoteBook } from "./noteBook";
import type { Party } from "./party";
import type { StuckDetector } from "./stuckDetector";

/** The frame time, and which opening of a board is current: every board opened starts a new epoch. */
export class GameClock {
  nowMs = 0;
  private epoch = 0;

  turnPage(): void {
    this.epoch += 1;
  }

  /** True for as long as the board open now stays open: work that outlives it is dropped. */
  pageGuard(): () => boolean {
    const epoch = this.epoch;
    return () => epoch === this.epoch;
  }
}

/** What the game's parts share: the modules, the page being played and the books kept about it. */
export interface GameContext {
  readonly modules: GameModules;
  readonly clock: GameClock;
  readonly director: ModeDirector;
  readonly hud: Hud;
  /** Where the board is kept; on a shared page, it also tells the link what this device wrote. */
  readonly store: BoardStore;
  readonly notes: NoteBook;
  readonly ledger: InkLedger;
  readonly party: Party;
  readonly camera: CameraRig;
  readonly ids: IdMint;
  readonly stuck: StuckDetector;
  readonly board: BoardDefinition;
}
