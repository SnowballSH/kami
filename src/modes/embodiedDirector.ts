import type { BoardDefinition } from "../board/types";
import type { Ruling } from "../cat/types";
import type { DrawingId } from "../ink/types";
import type { SimEvent } from "../sim/types";
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

  named(_drawingId: DrawingId, _ruling: Ruling): EmbodimentTransition | null {
    return null;
  }

  won(event: SimEvent): boolean {
    return this.mode.win.kind === "reach-goal" && event.type === "goal-reached";
  }

  close(): void {}
}

/** Null when nobody has built a director for how this mode opens yet. */
export const createDirector = (mode: GameMode): ModeDirector | null =>
  mode.opening.player === "body" ? new EmbodiedDirector(mode) : null;
