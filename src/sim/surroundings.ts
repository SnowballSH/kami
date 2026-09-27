import type Matter from "matter-js";
import type { AliceSurroundings } from "./alice";
import type { BoardWorld } from "./boardWorld";
import type { Feelers } from "./creatures";
import { NATURES, type NatureStrategy } from "./natures";
import type { Ride } from "./types";
import { liftsHer, rideOn } from "./vehicles";

/**
 * Alice's surroundings read live from the board, so what she senses after a step is the board after it.
 * `InkLayer` and `BoardProps` hand out a new list whenever theirs change, so the joined obstacle list
 * is rebuilt only when either list is no longer the one it was built from.
 */
export class LiveSurroundings implements AliceSurroundings {
  private joinedFrom: readonly [readonly Matter.Body[], readonly Matter.Body[]] | null = null;
  private joined: readonly Matter.Body[] = [];

  constructor(
    private readonly world: Pick<BoardWorld, "inks" | "props">,
    private readonly feelers: Feelers,
  ) {}

  get obstacles(): readonly Matter.Body[] {
    const solids = this.world.props.solidBodies;
    const inks = this.world.inks.solidToAlice;
    if (this.joinedFrom?.[0] !== solids || this.joinedFrom[1] !== inks) {
      this.joined = [...solids, ...inks];
      this.joinedFrom = [solids, inks];
    }
    return this.joined;
  }

  get passables(): readonly Matter.Body[] {
    return this.world.inks.passable;
  }

  isInk(body: Matter.Body): boolean {
    return this.world.inks.find(body) !== undefined;
  }

  isSlippery(body: Matter.Body): boolean {
    return this.natureOf(body)?.slippery ?? false;
  }

  isClimbable(body: Matter.Body): boolean {
    return this.natureOf(body)?.climbable ?? false;
  }

  liftsHer(body: Matter.Body): boolean {
    const ink = this.world.inks.find(body);
    return ink !== undefined && ink.nature === "vehicle" && liftsHer(ink, this.feelers);
  }

  rideOn(body: Matter.Body): Ride | null {
    const ink = this.world.inks.find(body);
    return ink === undefined ? null : rideOn(ink);
  }

  private natureOf(body: Matter.Body): NatureStrategy | undefined {
    const ink = this.world.inks.find(body);
    return ink === undefined ? undefined : NATURES[ink.nature];
  }
}
