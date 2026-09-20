import Matter from "matter-js";
import type { Vec } from "../core/geometry";
import { inEffectDomain } from "../rules/effectDomains";
import type { WorldPhysics } from "../rules/types";
import { AliceController } from "./alice";
import { bottomOf } from "./bodyBounds";
import type { AliceSnapshot } from "./types";

const SPACING = 1.5;
/** A twin this far from Alice sideways has stopped being her clone and is recalled to her feet. */
export const TWIN_STRAY_DISTANCE = 1600;

/** Where the n-th twin appears: alternating sides of Alice, further out each time. */
const besideAlice = (alice: AliceController, index: number): Vec => {
  const bounds = alice.bounds();
  const side = index % 2 === 0 ? 1 : -1;
  const rank = Math.floor(index / 2) + 1;
  return {
    x: bounds.x + bounds.width / 2 + side * rank * bounds.width * SPACING,
    y: bottomOf(bounds),
  };
};

/**
 * Alice's copies under a `clones` law. Each is a full AliceController with an intent of her own, so
 * every one of them walks, jumps and climbs her own way; they never collide with her or each other.
 */
export class Twins {
  private readonly twins: AliceController[] = [];

  constructor(private readonly composite: Matter.World) {}

  get all(): readonly AliceController[] {
    return this.twins;
  }

  /** Brings the head count to `count`, spawning newcomers beside Alice and dismissing extras. */
  match(count: number, alice: AliceController, physics: WorldPhysics): void {
    if (!inEffectDomain("clones", count)) throw new RangeError("Invalid clone count");
    while (this.twins.length > count) {
      const dismissed = this.twins.pop();
      if (dismissed !== undefined) Matter.Composite.remove(this.composite, dismissed.body);
    }
    while (this.twins.length < count) {
      const twin = new AliceController(besideAlice(alice, this.twins.length), physics);
      Matter.Composite.add(this.composite, twin.body);
      this.twins.push(twin);
    }
    for (const twin of this.twins) twin.applyPhysics(physics);
  }

  /** Any twin that has strayed far to one side of Alice rejoins her at her feet. */
  recallStrays(alice: AliceController): void {
    for (const twin of this.twins) {
      const strayed = Math.abs(twin.body.position.x - alice.body.position.x) > TWIN_STRAY_DISTANCE;
      if (strayed) twin.placeAt(besideAlice(alice, 0));
    }
  }

  snapshots(): readonly AliceSnapshot[] {
    return this.twins.map((twin) => twin.snapshot());
  }
}
