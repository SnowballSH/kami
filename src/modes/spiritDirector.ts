import type { BoardDefinition } from "../board/types";
import type { Ruling } from "../cat/types";
import type { DrawingId } from "../ink/types";
import { ALICE_HERSELF, type SimEvent } from "../sim/types";
import { namesABody } from "./bodyNames";
import { wonBy } from "./policy";
import type {
  EmbodimentTransition,
  GameMode,
  Incarnation,
  ModeDirector,
  PlayerState,
  RoomStaging,
} from "./types";

const spiritOf = (incarnation: Incarnation): PlayerState => ({ kind: "spirit", incarnation });

/**
 * The referee for any mode that opens with nobody on the board. The player is a spirit until a
 * drawing is named as a body; a `defeat-foe` mode then tears the page open for the servant to come
 * through. Losing the body — hers, not a twin's; the heart is in her — makes them a spirit again,
 * and the game enacts the mode's `LossRule`.
 */
export class SpiritDirector implements ModeDirector {
  state: PlayerState;
  readonly room: RoomStaging | null = null;

  constructor(
    readonly mode: GameMode,
    private readonly incarnation: Incarnation,
  ) {
    this.state = spiritOf(incarnation);
  }

  open(_board: BoardDefinition): PlayerState {
    this.state = spiritOf(this.incarnation);
    return this.state;
  }

  witness(event: SimEvent): readonly EmbodimentTransition[] {
    if (this.state.kind === "spirit") return [];
    switch (event.type) {
      case "fell":
        return event.who === ALICE_HERSELF ? this.unmade("fell") : [];
      case "alice-devoured":
        return event.who === ALICE_HERSELF ? this.unmade("devoured") : [];
      case "heart-swallowed":
        return this.unmade("swallowed");
      default:
        return [];
    }
  }

  /** A drawing named as a body becomes her; in a `defeat-foe` mode the tear opens once there is a body to hunt. */
  named(drawingId: DrawingId, ruling: Ruling): readonly EmbodimentTransition[] {
    if (this.state.kind === "body" || this.incarnation.kind === "born") return [];
    if (!namesABody(ruling.name, this.incarnation.names)) return [];
    this.state = { kind: "body" };
    const incarnated: EmbodimentTransition = {
      kind: "incarnated",
      by: "drawing",
      drawingId,
      name: ruling.name,
    };
    return this.mode.win.kind === "defeat-foe"
      ? [incarnated, { kind: "tear-opens" }]
      : [incarnated];
  }

  won(event: SimEvent): boolean {
    return wonBy(this.mode.win, event);
  }

  close(): void {
    this.state = spiritOf(this.incarnation);
  }

  private unmade(cause: "fell" | "devoured" | "swallowed"): readonly EmbodimentTransition[] {
    this.state = spiritOf(this.incarnation);
    return [{ kind: "unmade", cause }];
  }
}
