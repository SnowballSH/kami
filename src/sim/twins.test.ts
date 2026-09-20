import Matter from "matter-js";
import { describe, expect, it } from "vitest";
import { EARTH } from "../rules/types";
import { AliceController } from "./alice";
import { TWIN_STRAY_DISTANCE, Twins } from "./twins";

describe("Twins", () => {
  it("recalls a twin that has strayed far to one side back beside Alice", () => {
    const alice = new AliceController({ x: 0, y: 0 }, EARTH);
    const twins = new Twins(Matter.Engine.create().world);
    twins.match(1, alice, EARTH);
    const twin = twins.all[0];
    if (twin === undefined) throw new Error("no twin");
    twin.placeAt({ x: TWIN_STRAY_DISTANCE + 1, y: 0 });
    twins.recallStrays(alice);
    expect(Math.abs(twin.body.position.x)).toBeLessThan(200);

    twin.placeAt({ x: TWIN_STRAY_DISTANCE - 1, y: 0 });
    twins.recallStrays(alice);
    expect(twin.body.position.x).toBeCloseTo(TWIN_STRAY_DISTANCE - 1, 0);
  });
});

describe("Twins.match", () => {
  it.each([-1, 0.5, 9, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects %s without mutating an existing crowd",
    (count) => {
      const world = Matter.World.create({});
      const twins = new Twins(world);
      const alice = new AliceController({ x: 0, y: 0 }, EARTH);
      twins.match(2, alice, EARTH);
      expect(() => twins.match(count, alice, EARTH)).toThrow(RangeError);
      expect(twins.all).toHaveLength(2);
      expect(world.bodies).toHaveLength(2);
      twins.match(0, alice, EARTH);
      expect(world.bodies).toEqual([]);
    },
  );
});
