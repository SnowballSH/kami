import { describe, expect, it } from "vitest";
import { distance } from "../../core/geometry";
import { snip } from "../body/drawnBody";
import { FIGURE, figureBody, HEART, preyOf, ringAround } from "./figure.testSupport";
import { cutAcross, type Prey, Snipper, type SnipperDeed, targetOf } from "./snipper";
import { SNIPPER_TUNING, TEAR_TUNING } from "./tuning";

const TICK = 1000 / 60;
const FAR = { x: 100, y: -400 };

const runUntil = (
  snipper: Snipper,
  prey: Prey | null,
  done: (deed: SnipperDeed | null) => boolean,
  maxMs = 20_000,
  mercy = false,
): SnipperDeed | null => {
  for (let elapsed = 0; elapsed < maxMs; elapsed += TICK) {
    const deed = snipper.tick(TICK, prey, mercy);
    if (done(deed)) return deed;
  }
  return null;
};

const untilPhase = (snipper: Snipper, prey: Prey | null, phase: string, mercy = false): void => {
  runUntil(snipper, prey, () => snipper.currentPhase.kind === phase, 20_000, mercy);
};

describe("what it goes for", () => {
  it("snips the legs first, then arms, then the head, and the heart only when bare", () => {
    const body = figureBody();
    expect(targetOf(body)).toBe("legs");
    const legless = snip(body, { from: { x: -30, y: 40 }, to: { x: 30, y: 40 } }, "legs").body;
    expect(targetOf(legless)).toBe("arms");
    const blob = { ...body, strokes: [], fullest: body.fullest };
    expect(targetOf(blob)).toBeNull();
    expect(targetOf(figureBody("a blob"))).toBe("legs");
  });

  it("lays the cut across a limb, partway along it from the heart, in the world", () => {
    const cut = cutAcross(preyOf(), "legs", 40);
    const middle = { x: (cut.from.x + cut.to.x) / 2, y: (cut.from.y + cut.to.y) / 2 };
    const tip = { x: 88, y: 170 };
    const along = { x: tip.x - HEART.x, y: tip.y - HEART.y };
    const across = { x: cut.to.x - cut.from.x, y: cut.to.y - cut.from.y };
    expect(along.x * across.x + along.y * across.y).toBeCloseTo(0);
    expect(middle.y).toBeGreaterThan(HEART.y);
    expect(middle.y).toBeLessThan(tip.y);
    expect(distance(cut.from, cut.to)).toBeCloseTo(80);
  });

  it("aims through the heart itself when nothing is left to cut", () => {
    const cut = cutAcross(preyOf(), null, 30);
    expect((cut.from.y + cut.to.y) / 2).toBeCloseTo(HEART.y);
    expect((cut.from.x + cut.to.x) / 2).toBeCloseTo(HEART.x);
  });
});

describe("the snipper's round", () => {
  it("arrives, circles, winds up a visible cut, lunges along it, and rests", () => {
    const snipper = new Snipper("servant", FAR);
    const prey = preyOf();
    expect(snipper.snapshot().phase).toBe("arriving");
    untilPhase(snipper, prey, "circling");
    expect(distance(snipper.where, HEART)).toBeLessThanOrEqual(
      SNIPPER_TUNING.servant.orbitRadius + 30,
    );
    untilPhase(snipper, prey, "winding");
    const shown = snipper.snapshot();
    expect(shown.cut).not.toBeNull();
    expect(shown.phase).toBe("winding");
    const deed = runUntil(snipper, prey, (d) => d?.kind === "cut");
    expect(deed?.kind).toBe("cut");
    if (deed?.kind !== "cut") throw new Error("no cut");
    expect(deed.part).toBe("legs");
    expect(deed.cut).toEqual(shown.cut);
    expect(snipper.where.x).toBeCloseTo(deed.cut.to.x);
    expect(snipper.where.y).toBeCloseTo(deed.cut.to.y);
    expect(snipper.snapshot().phase).toBe("recovering");
    expect(snipper.snapshot().cut).toBeNull();
    untilPhase(snipper, prey, "circling");
    expect(snipper.ramp).toBeCloseTo(1 + SNIPPER_TUNING.servant.speedRampPerSnip);
  });

  it("gives the servant a longer first circle before winding up", () => {
    const snipper = new Snipper("servant", FAR);
    const prey = preyOf();
    untilPhase(snipper, prey, "circling");
    for (
      let elapsed = 0;
      elapsed < SNIPPER_TUNING.servant.firstCircleMs - TICK * 2;
      elapsed += TICK
    )
      snipper.tick(TICK, prey, false);
    expect(snipper.currentPhase.kind).toBe("circling");
  });

  it("keeps the cut where it was shown even when the body moves away", () => {
    const snipper = new Snipper("servant", FAR);
    const prey = preyOf();
    untilPhase(snipper, prey, "winding");
    const shown = snipper.snapshot().cut;
    const moved: Prey = { ...prey, heart: { x: 600, y: 100 }, centre: { x: 600, y: 109 } };
    const deed = runUntil(snipper, moved, (d) => d?.kind === "cut");
    expect(deed?.kind === "cut" && deed.cut).toEqual(shown);
  });

  it("holds its blades while mercy lasts", () => {
    const snipper = new Snipper("servant", FAR);
    const prey = preyOf();
    untilPhase(snipper, prey, "circling");
    for (let ms = 0; ms < SNIPPER_TUNING.servant.circleMs * 2; ms += TICK)
      snipper.tick(TICK, prey, true);
    expect(snipper.snapshot().phase).toBe("circling");
    untilPhase(snipper, prey, "winding");
    expect(snipper.snapshot().phase).toBe("winding");
  });

  it("only circles when there is no body to hunt", () => {
    const snipper = new Snipper("lesser", FAR);
    untilPhase(snipper, null, "circling");
    for (let ms = 0; ms < 10_000; ms += TICK) snipper.tick(TICK, null, false);
    expect(snipper.snapshot().phase).toBe("circling");
  });

  it("quickens a little with every snip, up to a ceiling", () => {
    const snipper = new Snipper("servant", FAR);
    const prey = preyOf();
    let snips = 0;
    for (let ms = 0; ms < 200_000 && snips < 20; ms += TICK) {
      if (snipper.tick(TICK, prey, false)?.kind === "cut") snips += 1;
    }
    expect(snips).toBeGreaterThanOrEqual(10);
    expect(snipper.ramp).toBe(SNIPPER_TUNING.servant.maxSpeedRamp);
  });
});

describe("hurting it", () => {
  it("takes a blow, is thrown back, and cannot be struck again at once", () => {
    const snipper = new Snipper("servant", { x: 100, y: 0 });
    const before = snipper.where;
    expect(snipper.hurt(TEAR_TUNING.hitDamage, { x: 100, y: 40 })).toBe(true);
    expect(snipper.health).toBe(SNIPPER_TUNING.servant.health - TEAR_TUNING.hitDamage);
    expect(snipper.where.y).toBeLessThan(before.y);
    expect(snipper.hurt(TEAR_TUNING.hitDamage, { x: 100, y: 40 })).toBe(false);
    snipper.tick(TEAR_TUNING.hitInvulnerableMs, null, false);
    expect(snipper.hurt(TEAR_TUNING.hitDamage, { x: 100, y: 40 })).toBe(true);
    expect(snipper.snapshot().hurtAgoMs).toBe(0);
  });

  it("drops a wind-up when struck", () => {
    const snipper = new Snipper("servant", FAR);
    const prey = preyOf();
    untilPhase(snipper, prey, "winding");
    snipper.hurt(1, HEART);
    expect(snipper.snapshot().phase).toBe("recovering");
    expect(snipper.snapshot().cut).toBeNull();
  });

  it("perishes at no health and is gone after its last breath", () => {
    const snipper = new Snipper("lesser", FAR);
    snipper.hurt(SNIPPER_TUNING.lesser.health, HEART);
    expect(snipper.perished).toBe(true);
    expect(snipper.snapshot().phase).toBe("perishing");
    expect(snipper.hurt(5, HEART)).toBe(false);
    const deed = runUntil(snipper, preyOf(), (d) => d?.kind === "perished");
    expect(deed?.kind).toBe("perished");
  });
});

describe("cutting a drawn body", () => {
  it("a lunge across the legs takes them and their walking", () => {
    const snipper = new Snipper("servant", FAR);
    const body = figureBody();
    const deed = runUntil(snipper, preyOf(body), (d) => d?.kind === "cut");
    if (deed?.kind !== "cut") throw new Error("no cut");
    const local = {
      from: { x: deed.cut.from.x - 100, y: deed.cut.from.y - 109 },
      to: { x: deed.cut.to.x - 100, y: deed.cut.to.y - 109 },
    };
    const { lost, removed } = snip(body, local, "legs");
    expect(lost).toEqual(["legs"]);
    expect(removed).toHaveLength(2);
    expect(FIGURE).toHaveLength(6);
    expect(ringAround(HEART, 1)).toHaveLength(17);
  });
});
