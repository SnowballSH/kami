import type { BoardDefinition } from "../board/types";
import type { Ruling } from "../cat/types";
import type { DrawingId } from "../ink/types";
import type { SimEvent } from "../sim/types";
import { wonBy } from "./policy";
import { SpiritDirector } from "./spiritDirector";
import type { EmbodimentTransition, GameMode, ModeDirector, PlayerState } from "./types";

const BODY: PlayerState = { kind: "body" };

/** The referee for any mode that opens with a body: she is there from the first frame and the sim's own respawn is the loss rule. */
export class EmbodiedDirector implements ModeDirector {
  state: PlayerState = BODY;

  constructor(readonly mode: GameMode) {}

  open(_board: BoardDefinition): PlayerState {
    this.state = BODY;
    return this.state;
  }

  witness(_event: SimEvent): readonly EmbodimentTransition[] {
    return [];
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
