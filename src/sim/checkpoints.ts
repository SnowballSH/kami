import type { BoardDefinition, Zone } from "../board/types";
import type { Vec } from "../core/geometry";

/** Which zones Alice has reached, and where that puts her back if she is lost. */
export class Checkpoints {
  private readonly entered = new Set<string>();
  private latest: Zone | null = null;

  constructor(private readonly board: BoardDefinition) {}

  get respawn(): Vec {
    return this.latest?.checkpoint ?? this.board.spawn;
  }

  /** The zone she has just set foot in for the first time, or null. */
  visit(aliceX: number): Zone | null {
    const zone = this.board.zones.findLast((candidate) => candidate.fromX <= aliceX);
    if (zone === undefined || this.entered.has(zone.id)) return null;
    this.entered.add(zone.id);
    this.latest = zone;
    return zone;
  }
}
