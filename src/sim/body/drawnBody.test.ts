import { describe, expect, it } from "vitest";
import type { Stroke, Vec } from "../../core/geometry";
import { EFFECT_DOMAINS } from "../../rules/effectDomains";
import { BODY_TUNING } from "../boss/tuning";
import { ALICE_BASE } from "../types";
import {
  abilitiesOf,
  aliveParts,
  bodyStrokesInWorld,
  graft,
  heartInWorld,
  incarnate,
  namesWings,
  partReach,
  snip,
  toBodySpace,
  toWorldSpace,
} from "./drawnBody";
import type { BodyPartKind, DrawnBody } from "./types";

const HEART: Vec = { x: 100, y: 100 };

const line = (from: Vec, to: Vec, points = 6): Stroke =>
  Array.from({ length: points }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / (points - 1),
    y: from.y + ((to.y - from.y) * i) / (points - 1),
  }));

const ring = (centre: Vec, radius: number, points = 16): Stroke =>
  Array.from({ length: points + 1 }, (_, i) => ({
    x: centre.x + radius * Math.cos((i / points) * Math.PI * 2),
    y: centre.y + radius * Math.sin((i / points) * Math.PI * 2),
  }));

const HEAD = ring({ x: 100, y: 60 }, 12);
const TORSO = ring(HEART, 20);
const LEFT_ARM = line({ x: 80, y: 95 }, { x: 50, y: 105 });
const RIGHT_ARM = line({ x: 120, y: 95 }, { x: 150, y: 105 });
const LEFT_LEG = line({ x: 92, y: 120 }, { x: 88, y: 170 });
const RIGHT_LEG = line({ x: 108, y: 120 }, { x: 112, y: 170 });
const FIGURE = [HEAD, TORSO, LEFT_ARM, RIGHT_ARM, LEFT_LEG, RIGHT_LEG];

const figure = (name = "alice"): DrawnBody => incarnate(FIGURE, HEART, name, 0).body;

const partsOf = (body: DrawnBody): readonly BodyPartKind[] => body.strokes.map((s) => s.part);

describe("incarnating a drawing", () => {
  it("centres the body on the drawing and keeps the heart where it was drawn around", () => {
    const { body, centre } = incarnate(FIGURE, HEART, "alice", 0);
    expect(centre).toEqual({ x: 100, y: 109 });
    expect(body.frame).toEqual({ width: 100, height: 122 });
    expect(body.heart).toEqual({ x: 0, y: -9 });
    expect(heartInWorld(body, { centre, facing: 1, scale: 1 })).toEqual(HEART);
  });

  it("segments strokes about the heart: torso around it, head above, arms beside, legs below", () => {
    expect(partsOf(figure())).toEqual(["head", "torso", "arms", "arms", "legs", "legs"]);
  });

  it("calls a stroke sticking up and out a wing, and is quicker to when the name has wings", () => {
    const wing = line({ x: 115, y: 80 }, { x: 160, y: 40 });
    const shortWing = line({ x: 112, y: 82 }, { x: 130, y: 50 });
    expect(partsOf(incarnate([...FIGURE, wing], HEART, "alice", 0).body).at(-1)).toBe("wings");
    expect(partsOf(incarnate([...FIGURE, shortWing], HEART, "alice", 0).body).at(-1)).toBe("head");
    expect(partsOf(incarnate([...FIGURE, shortWing], HEART, "a bird", 0).body).at(-1)).toBe(
      "wings",
    );
    expect(namesWings("an angel")).toBe(true);
    expect(namesWings("me")).toBe(false);
  });

  it("puts the heart in the chest when the body was drawn beside it rather than around it", () => {
    const aside = FIGURE.map((stroke) => stroke.map((p) => ({ x: p.x + 300, y: p.y })));
    const { body } = incarnate(aside, HEART, "her", 0);
    expect(body.heart).toEqual({ x: 0, y: -body.frame.height * 0.1 });
  });

  it("fits a giant or a tiny drawing into the sizes the laws allow, speed scaling with it", () => {
    const { max, min } = EFFECT_DOMAINS.aliceSize;
    const giant = FIGURE.map((stroke) => stroke.map((p) => ({ x: p.x * 10, y: p.y * 10 })));
    expect(incarnate(giant, HEART, "alice", 0).body.frame.height).toBeCloseTo(
      ALICE_BASE.height * max,
    );
    const speck = [line({ x: 0, y: 0 }, { x: 3, y: 4 })];
    expect(incarnate(speck, HEART, "alice", 0).body.frame.height).toBeCloseTo(
      ALICE_BASE.height * min,
    );
  });

  it("gives a body every ability its parts stand for, and flight only with wings", () => {
    expect(abilitiesOf(figure())).toEqual({
      walk: true,
      jump: true,
      climb: true,
      fly: false,
      see: true,
    });
    const blob = incarnate([ring(HEART, 30)], HEART, "a blob", 0).body;
    expect(abilitiesOf(blob)).toEqual({
      walk: false,
      jump: false,
      climb: false,
      fly: false,
      see: false,
    });
  });
});

describe("body space", () => {
  it("maps between the world and her, mirrored when she faces left", () => {
    const space = { centre: { x: 50, y: 20 }, facing: -1 as const, scale: 2 };
    const local = toBodySpace({ x: 30, y: 30 }, space);
    expect(local).toEqual({ x: 10, y: 5 });
    expect(toWorldSpace(local, space)).toEqual({ x: 30, y: 30 });
    const [first] = bodyStrokesInWorld(figure(), {
      centre: { x: 100, y: 109 },
      facing: 1,
      scale: 1,
    });
    expect(first?.[0]).toEqual(HEAD[0]);
  });
});

describe("snipping", () => {
  const body = figure();
  const acrossLegs = { from: { x: -30, y: 40 }, to: { x: 30, y: 40 } };

  it("removes the strokes the cut crosses and the ability that stood on them", () => {
    const { body: after, removed, lost, heartCut } = snip(body, acrossLegs);
    expect(removed.map((s) => s.part)).toEqual(["legs", "legs"]);
    expect(lost).toEqual(["legs"]);
    expect(heartCut).toBe(false);
    expect(abilitiesOf(after).walk).toBe(false);
    expect(abilitiesOf(after).climb).toBe(true);
    expect(after.strokes).toHaveLength(4);
  });

  it("takes only one of two legs without losing the ability while enough ink stands", () => {
    const oneLeg = { from: { x: -20, y: 40 }, to: { x: -4, y: 40 } };
    const { removed, lost } = snip(body, oneLeg);
    expect(removed).toHaveLength(1);
    expect(lost).toEqual([]);
  });

  it("misses when the cut passes through empty paper", () => {
    const { removed, lost } = snip(body, { from: { x: 200, y: 200 }, to: { x: 260, y: 200 } });
    expect(removed).toEqual([]);
    expect(lost).toEqual([]);
  });

  it("only reaches the heart once nothing is around it", () => {
    const throughHeart = { from: { x: -40, y: -9 }, to: { x: 40, y: -9 } };
    const first = snip(body, throughHeart);
    expect(first.removed.map((s) => s.part)).toEqual(["torso", "arms", "arms"]);
    expect(first.heartCut).toBe(false);
    const second = snip(first.body, throughHeart);
    expect(second.heartCut).toBe(true);
  });
});

describe("grafting", () => {
  const legless = snip(figure(), { from: { x: -30, y: 40 }, to: { x: 30, y: 40 } }).body;
  const space = { centre: { x: 100, y: 109 }, facing: 1 as const, scale: 1 };
  const local = (stroke: Stroke): Stroke => stroke.map((p) => toBodySpace(p, space));

  it("restores a lost part when strokes drawn onto the body land where it was", () => {
    expect(abilitiesOf(legless).walk).toBe(false);
    const grafted = graft(legless, [local(LEFT_LEG), local(RIGHT_LEG)], 500);
    expect(grafted).not.toBeNull();
    expect(grafted?.restored).toEqual(["legs"]);
    expect(grafted?.added.every((s) => s.part === "legs" && s.sinceMs === 500)).toBe(true);
    expect(abilitiesOf(grafted?.body ?? legless).walk).toBe(true);
  });

  it("needs enough ink back before the part counts as whole again", () => {
    const stub = local(line({ x: 92, y: 120 }, { x: 91, y: 132 }));
    const grafted = graft(legless, [stub], 0);
    expect(grafted?.restored).toEqual([]);
    expect(abilitiesOf(grafted?.body ?? legless).walk).toBe(false);
  });

  it("grows a part she never had: wings drawn onto her let her fly", () => {
    const wings = local(line({ x: 115, y: 80 }, { x: 160, y: 40 }));
    const grafted = graft(figure(), [wings], 0);
    expect(grafted?.restored).toEqual(["wings"]);
    expect(abilitiesOf(grafted?.body ?? legless).fly).toBe(true);
    expect(aliveParts(grafted?.body ?? legless)).toContain("wings");
  });

  it("leaves strokes that never reach her to be ordinary ink", () => {
    const far = local(line({ x: 400, y: 400 }, { x: 450, y: 450 }));
    expect(graft(legless, [far], 0)).toBeNull();
    const reach = BODY_TUNING.graftReach;
    const justOutside = local(line({ x: 150 + reach + 1, y: 109 }, { x: 200, y: 109 }));
    expect(graft(legless, [justOutside], 0)).toBeNull();
  });
});

describe("part reach", () => {
  it("finds the tip of a part farthest from the heart", () => {
    const body = figure();
    const legs = partReach(body, "legs");
    expect(legs?.tip.y).toBeCloseTo(61);
    expect(partReach(body, "wings")).toBeNull();
  });
});
