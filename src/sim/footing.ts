import type { Vec } from "../core/geometry";

/** Falling this far below the last place she stood is falling off an endless page. */
export const FALL_LIMIT = 2400;

/**
 * Where Alice last stood on an endless page, and where that puts her back if she falls off it. If
 * the ink she stood on is gone by then she falls again, and that second fall returns her to the spawn.
 */
export class LastFooting {
  private latest: Vec | null = null;
  private spent = false;

  constructor(private readonly spawn: Vec) {}

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
