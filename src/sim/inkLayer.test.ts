import Matter from "matter-js";
import { describe, expect, it } from "vitest";
import type { Rect } from "../core/geometry";
import { EARTH } from "../rules/types";
import { type AnchorSource, InkLayer } from "./inkLayer";
import { blob, drawingOf, line } from "./testSupport";

const LEFT_BANK: Rect = { x: 0, y: 560, width: 380, height: 200 };
const RIGHT_BANK: Rect = { x: 600, y: 560, width: 250, height: 200 };

const bridge = () => drawingOf("bridge", line({ x: 370, y: 556 }, { x: 610, y: 556 }));
const loose = () => drawingOf("loose", blob(1000, 100, 60, 40));

const setup = () => {
  const world = Matter.World.create({});
  const anchorRects: Rect[] = [LEFT_BANK, RIGHT_BANK];
  const anchors: AnchorSource = { anchorRects };
  const layer = new InkLayer(world, anchors, EARTH);
  return { layer, anchorRects };
};

describe("InkLayer cached derived lists", () => {
  it("memoises all/dynamicBodies/heldBounds until something changes", () => {
    const { layer } = setup();
    layer.add(bridge());
    layer.add(loose());

    expect(layer.all).toBe(layer.all);
    expect(layer.dynamicBodies).toBe(layer.dynamicBodies);
    expect(layer.heldBounds).toBe(layer.heldBounds);
  });

  it("holds ink spanning two anchors static, and leaves unanchored ink dynamic", () => {
    const { layer } = setup();
    layer.add(bridge());
    layer.add(loose());

    expect(layer.all).toHaveLength(2);
    expect(layer.heldBounds).toHaveLength(1);
    expect(layer.dynamicBodies).toHaveLength(1);
    const held = layer.all.find((ink) => ink.id === "bridge");
    const free = layer.all.find((ink) => ink.id === "loose");
    expect(held?.body.isStatic).toBe(true);
    expect(free?.body.isStatic).toBe(false);
    expect(layer.dynamicBodies).toContain(free?.body);
    expect(layer.dynamicBodies).not.toContain(held?.body);
  });

  it("recomputes after add and remove", () => {
    const { layer } = setup();
    layer.add(bridge());
    const beforeAll = layer.all;
    const beforeHeld = layer.heldBounds;

    layer.add(loose());
    expect(layer.all).not.toBe(beforeAll);
    expect(layer.all).toHaveLength(2);
    expect(layer.dynamicBodies).toHaveLength(1);

    layer.remove("loose" as never);
    expect(layer.all).toHaveLength(1);
    expect(layer.dynamicBodies).toHaveLength(0);
    expect(layer.heldBounds).not.toBe(beforeHeld);
    expect(layer.heldBounds).toHaveLength(1);
  });

  it("moves ink between heldBounds and dynamicBodies as a ruling frees or re-anchors it", () => {
    const { layer } = setup();
    layer.add(bridge());
    expect(layer.heldBounds).toHaveLength(1);
    expect(layer.dynamicBodies).toHaveLength(0);

    layer.applyRuling("bridge" as never, {
      name: "walker",
      nature: "walker",
      strength: 1,
      tags: [],
      line: "",
    });
    expect(layer.heldBounds).toHaveLength(0);
    expect(layer.dynamicBodies).toHaveLength(1);

    layer.applyRuling("bridge" as never, {
      name: "ink",
      nature: "ink",
      strength: 1,
      tags: [],
      line: "",
    });
    expect(layer.heldBounds).toHaveLength(1);
    expect(layer.dynamicBodies).toHaveLength(0);
  });

  it("moves ink from dynamicBodies to heldBounds once frozen", () => {
    const { layer } = setup();
    layer.add(loose());
    const ink = layer.all.find((each) => each.id === "loose");
    if (ink === undefined) throw new Error("loose ink missing");
    expect(layer.dynamicBodies).toHaveLength(1);
    expect(layer.heldBounds).toHaveLength(0);

    layer.freeze(ink);
    expect(layer.dynamicBodies).toHaveLength(0);
    expect(layer.heldBounds).toHaveLength(1);
  });
});
