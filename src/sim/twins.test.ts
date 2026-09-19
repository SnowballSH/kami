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
    twins.recallLost(alice, 10_000);
    expect(Math.abs(twin.body.position.x)).toBeLessThan(200);

    twin.placeAt({ x: TWIN_STRAY_DISTANCE - 1, y: 0 });
    twins.recallLost(alice, 10_000);
    expect(twin.body.position.x).toBeCloseTo(TWIN_STRAY_DISTANCE - 1, 0);
  });
});
