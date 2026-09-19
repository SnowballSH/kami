import Matter from "matter-js";
import { describe, expect, it } from "vitest";
import { poseToWorld } from "../core/geometry";
import { resolvePhysics } from "../rules";
import { InkLayer } from "./inkLayer";
import { drawingOf, rulingOf } from "./testSupport";

const DRAWING = drawingOf("moving", [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
]);
const REPLACEMENT = {
  ...DRAWING,
  strokes: [
    [
      { x: 0, y: 4 },
      { x: 100, y: 4 },
      { x: 100, y: 80 },
    ],
  ],
};

describe("InkLayer replacement", () => {
  it("rebuilds a moving body's geometry without losing its transform, nature or motion", () => {
    const world = Matter.Engine.create().world;
    const layer = new InkLayer(world, [], resolvePhysics([]));
    layer.add(DRAWING);
    layer.applyRuling(DRAWING.id, rulingOf("heavy", 0.7));
    const [ink] = layer.all;
    if (ink === undefined) throw new Error("missing ink");
    ink.warmth = 25;
    const mind = ink.mind;
    const previous = ink.body;
    Matter.Body.setPosition(previous, { x: 250, y: 400 });
    Matter.Body.setAngle(previous, Math.PI / 3);
    Matter.Body.setVelocity(previous, { x: 3, y: -2 });
    Matter.Body.setAngularVelocity(previous, 0.1);
    const pose = ink.pose;

    expect(layer.replace(REPLACEMENT)).toBe(true);
    expect(layer.all).toEqual([ink]);
    expect(ink.drawing).toBe(REPLACEMENT);
    expect(ink.body).not.toBe(previous);
    expect(layer.find(previous)).toBeUndefined();
    expect(layer.find(ink.body)).toBe(ink);
    expect(Matter.Composite.allBodies(world)).toEqual([ink.body]);
    expect(ink).toMatchObject({ nature: "heavy", strength: 0.7, warmth: 25, mind });
    expect(ink.body.angle).toBeCloseTo(pose.angle);
    expect(Matter.Body.getVelocity(ink.body)).toEqual({ x: 3, y: -2 });
    expect(Matter.Body.getAngularVelocity(ink.body)).toBeCloseTo(0.1);
    for (const [i, stroke] of REPLACEMENT.strokes.entries()) {
      for (const [j, point] of stroke.entries()) {
        const expected = poseToWorld(point, pose);
        expect(ink.worldStrokes[i]?.[j]?.x).toBeCloseTo(expected.x);
        expect(ink.worldStrokes[i]?.[j]?.y).toBeCloseTo(expected.y);
      }
    }
  });

  it("retains pinned roles and frozen bodies", () => {
    const layer = new InkLayer(Matter.Engine.create().world, [], resolvePhysics([]));
    layer.add(DRAWING);
    layer.applyRuling(DRAWING.id, rulingOf("goal"));
    const [ink] = layer.all;
    if (ink === undefined) throw new Error("missing ink");
    const filter = { ...ink.body.collisionFilter };
    expect(layer.replace(REPLACEMENT)).toBe(true);
    expect(ink.body.isStatic).toBe(true);
    expect(ink.body.collisionFilter).toEqual(filter);
    expect(ink.worldStrokes).toEqual(REPLACEMENT.strokes);

    layer.applyRuling(DRAWING.id, rulingOf("ink"));
    layer.freeze(ink);
    expect(layer.replace(DRAWING)).toBe(true);
    expect(ink.frozen).toBe(true);
    expect(ink.body.isStatic).toBe(true);
  });

  it("cannot resurrect removed ink or discard a body for an empty replacement", () => {
    const layer = new InkLayer(Matter.Engine.create().world, [], resolvePhysics([]));
    layer.add(DRAWING);
    expect(layer.replace({ ...DRAWING, strokes: [] })).toBe(false);
    expect(layer.all[0]?.drawing).toBe(DRAWING);
    layer.remove(DRAWING.id);
    expect(layer.replace(REPLACEMENT)).toBe(false);
    expect(layer.all).toEqual([]);
  });
});
