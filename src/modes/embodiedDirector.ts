import type { BoardDefinition } from "../board/types";
import type { Ruling } from "../cat/types";
import type { DrawingId } from "../ink/types";
import { ALICE_HERSELF, type SimEvent } from "../sim/types";
import { wonBy } from "./policy";
import { SpiritDirector } from "./spiritDirector";
import type {
  EmbodimentTransition,
  GameMode,
  ModeDirector,
  PlayerState,
  RoomStaging,
} from "./types";

const BODY: PlayerState = { kind: "body" };

/**
 * The referee for any mode that opens with a body: she is there from the first frame. A fall is
 * always the sim's own respawn; being devoured is too, unless the mode's `LossRule` says otherwise,
 * in which case she is unmade and the game enacts that rule.
 */
export class EmbodiedDirector implements ModeDirector {
  state: PlayerState = BODY;
  room: RoomStaging | null = null;
  readonly bodyNames: readonly string[] = [];

  constructor(readonly mode: GameMode) {}

  open(_board: BoardDefinition): PlayerState {
    this.state = BODY;
    return this.state;
  }

  witness(event: SimEvent): readonly EmbodimentTransition[] {
    const devouredForGood =
      event.type === "alice-devoured" &&
      event.who === ALICE_HERSELF &&
      this.mode.loss.kind !== "respawn";
    return devouredForGood ? [{ kind: "unmade", cause: "devoured" }] : [];
  }

  named(_drawingId: DrawingId, _ruling: Ruling): readonly EmbodimentTransition[] {
    return [];
  }

  won(event: SimEvent): boolean {
    return wonBy(this.mode.win, event);
  }

  close(): void {}
}

export const createDirector = (mode: GameMode): ModeDirector => {
  switch (mode.opening.player) {
    case "body":
      return new EmbodiedDirector(mode);
    case "spirit":
      return new SpiritDirector(mode, mode.opening.incarnation);
  }
};
