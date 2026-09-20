import { describe, expect, it } from "vitest";
import { idOf } from "../../sim/testSupport";
import { ALICE_BASE, type AliceSnapshot, type SimEvent } from "../../sim/types";
import { REINK_MS } from "./aliceAnimator";
import { AliceTroupe } from "./aliceTroupe";

const at = (x: number): AliceSnapshot => ({
  center: { x, y: 100 },
  velocity: { x: 0, y: 0 },
  width: ALICE_BASE.width,
  height: ALICE_BASE.height,
  size: "normal",
  sizeMultiplier: 1,
  headingScale: 1,
  facing: 1,
  walking: false,
  grounded: true,
  climbing: false,
  hasKey: false,
  ride: null,
  look: { kind: "alice" },
});

const settle = (troupe: AliceTroupe, alices: readonly AliceSnapshot[]): void => {
  troupe.count(alices.length);
  for (const nowMs of [-10_000, -9_000]) {
    alices.forEach((alice, who) => {
      troupe.figureOf(who, alice, [], nowMs);
    });
  }
};

describe("AliceTroupe", () => {
  it("gives each Alice her own beats and inks a new twin in when she appears", () => {
    const troupe = new AliceTroupe();
    settle(troupe, [at(0)]);
    troupe.count(2);
    expect(troupe.figureOf(0, at(0), [], 0).inked).toBe(1);
    expect(troupe.figureOf(1, at(0), [], 0).inked).toBe(0);
    expect(troupe.figureOf(1, at(0), [], REINK_MS).inked).toBe(1);
  });

  it("routes a warp to the Alice it happened to", () => {
    const troupe = new AliceTroupe();
    settle(troupe, [at(0), at(50)]);
    const events: readonly SimEvent[] = [
      { type: "warped", who: 1, from: idOf("a"), to: idOf("b") },
    ];
    const herself = troupe.figureOf(0, at(2000), events, 0);
    expect(herself.ghost).not.toBeNull();
    expect(herself.inked).toBe(0);
    const twin = troupe.figureOf(1, at(2050), events, 0);
    expect(twin.ghost).toBeNull();
    expect(twin.stretch.x).toBeCloseTo(0.2);
  });

  it("refuses an Alice it was not counted for", () => {
    const troupe = new AliceTroupe();
    troupe.count(1);
    expect(() => troupe.figureOf(1, at(0), [], 0)).toThrow(RangeError);
  });
});
