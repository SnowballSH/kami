import type { Vec } from "../core/geometry";
import { ALICE_HERSELF, type AliceIndex } from "./types";

/** Falling this far below the last place she stood is falling off an endless page. */
export const FALL_LIMIT = 900;

/**
 * Where Alice last stood on an endless page, and where that puts her back if she falls off it. If
 * the ink she stood on is gone by then she falls again, and that second fall returns her to the spawn.
 */
export class LastFooting {
  private spent = false;

  constructor(
    private readonly spawn: Vec,
    private latest: Vec | null = null,
  ) {}

  /** A footing of her own for a twin who appears beside Alice: it starts where Alice last stood. */
  fork(): LastFooting {
    return new LastFooting(this.spawn, this.latest);
  }

  stood(feet: Vec): void {
    this.latest = feet;
    this.spent = false;
  }

  fallen(position: Vec): boolean {
    return position.y > (this.latest ?? this.spawn).y + FALL_LIMIT;
  }

  respawn(): Vec {
    if (this.latest === null || this.spent) {
      this.latest = null;
      this.spent = false;
      return this.spawn;
    }
    this.spent = true;
    return this.latest;
  }
}

/**
 * Every Alice's own last footing, by her place on the roster, so each is judged fallen from where
 * she herself last stood. Alice herself keeps hers through new bodies; a twin's starts as a copy of hers.
 */
export class Footings {
  private readonly herself: LastFooting;
  private readonly twins: LastFooting[] = [];

  constructor(spawn: Vec) {
    this.herself = new LastFooting(spawn);
  }

  of(who: AliceIndex): LastFooting {
    if (who === ALICE_HERSELF) return this.herself;
    while (this.twins.length < who) this.twins.push(this.herself.fork());
    return this.twins[who - 1] ?? this.herself;
  }

  /** Forgets the footings of twins who are no longer on a roster of `count` Alices. */
  keep(count: number): void {
    this.twins.length = Math.min(this.twins.length, Math.max(0, count - 1));
  }
}
