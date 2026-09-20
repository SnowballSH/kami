import { describe, expect, it } from "vitest";
import { HEART, preyOf } from "./figure.testSupport";
import type { Snipper } from "./snipper";
import { Tear, type TearDeed } from "./tear";
import { SNIPPER_TUNING, TEAR_TUNING } from "./tuning";

const TICK = 1000 / 60;
const RIP = { x: 100, y: -300 };

const runFor = (tear: Tear, ms: number, prey = preyOf()): TearDeed[] => {
  const deeds: TearDeed[] = [];
  for (let elapsed = 0; elapsed < ms; elapsed += TICK) deeds.push(...tear.tick(TICK, prey));
  return deeds;
};

const opened = (): Tear => {
  const tear = new Tear(RIP);
  runFor(tear, TEAR_TUNING.entryDelayMs + TICK);
  return tear;
};

const servantOf = (tear: Tear): Snipper => {
  const servant = tear.alive.find((s) => s.rank === "servant");
  if (servant === undefined) throw new Error("no servant");
  return servant;
};

const wound = (tear: Tear, toHealth: number): void => {
  const servant = servantOf(tear);
  servant.health = SNIPPER_TUNING.servant.health * toHealth;
};

describe("the tear", () => {
  it("opens for a breath, then the servant comes through it", () => {
    const tear = new Tear(RIP);
    expect(tear.snapshot().phase).toBe("opening");
    expect(runFor(tear, TEAR_TUNING.entryDelayMs / 2)).toEqual([]);
    expect(tear.snapshot().progress).toBeGreaterThan(0.4);
    let came: readonly TearDeed[] = [];
    for (let ms = 0; ms < TEAR_TUNING.entryDelayMs && came.length === 0; ms += TICK)
      came = tear.tick(TICK, preyOf());
    expect(came).toEqual([{ kind: "servant-came" }]);
    const shown = tear.snapshot();
    expect(shown.phase).toBe("open");
    expect(shown.health).toBe(1);
    expect(shown.snippers.map((s) => s.rank)).toEqual(["servant"]);
    expect(shown.snippers[0]?.position).toEqual(RIP);
    expect(shown.snippers[0]?.phase).toBe("arriving");
  });

  it("sends lessers as the servant weakens, one wave per threshold, never a third", () => {
    const tear = opened();
    const [first, second] = TEAR_TUNING.waves;
    if (first === undefined || second === undefined) throw new Error("two waves");
    wound(tear, first.belowHealth - 0.01);
    expect(runFor(tear, TICK)).toEqual([{ kind: "wave", lessers: first.lessers }]);
    expect(tear.snapshot().wave).toBe(1);
    expect(runFor(tear, TICK * 10).filter((d) => d.kind === "wave")).toEqual([]);
    wound(tear, second.belowHealth - 0.01);
    expect(runFor(tear, TICK)).toEqual([{ kind: "wave", lessers: second.lessers }]);
    expect(tear.snapshot().snippers.filter((s) => s.rank === "lesser")).toHaveLength(
      first.lessers + second.lessers,
    );
    wound(tear, 0.05);
    expect(runFor(tear, TICK * 10).filter((d) => d.kind === "wave")).toEqual([]);
  });

  it("does not send a wave into an empty room", () => {
    const tear = opened();
    wound(tear, 0.1);
    for (let ms = 0; ms < 500; ms += TICK) expect(tear.tick(TICK, null)).toEqual([]);
  });

  it("keeps a mercy window after a snip lands and remembers the cut for a flash", () => {
    const tear = opened();
    const cut = { from: HEART, to: { x: HEART.x + 40, y: HEART.y } };
    tear.landed(cut);
    expect(tear.inMercy).toBe(true);
    expect(tear.snapshot().mercy).toBe(true);
    runFor(tear, TEAR_TUNING.mercyMs + TICK);
    expect(tear.inMercy).toBe(false);
  });

  it("reports each lunge, marks it, and lets the marks fade", () => {
    const tear = opened();
    const deeds = runFor(tear, 20_000);
    const cut = deeds.find((d) => d.kind === "cut");
    expect(cut?.kind).toBe("cut");
    if (cut?.kind !== "cut") throw new Error("no cut");
    expect(cut.rank).toBe("servant");
    expect(cut.part).toBe("legs");
  });

  it("closes when the servant is unmade, taking the lessers with it", () => {
    const tear = opened();
    wound(tear, 0.2);
    runFor(tear, TICK);
    expect(tear.alive.length).toBeGreaterThan(1);
    const servant = servantOf(tear);
    expect(tear.hurt(servant, servant.health, HEART)).toBe(true);
    expect(servant.perished).toBe(true);
    const deeds = runFor(tear, TEAR_TUNING.perishMs + TICK * 2);
    expect(deeds).toContainEqual({ kind: "servant-perished", rank: "servant" });
    expect(tear.snapshot().phase).toBe("closing");
    expect(tear.snapshot().snippers).toEqual([]);
    expect(tear.snapshot().health).toBe(0);
    const closed = runFor(tear, TEAR_TUNING.closingMs + TICK);
    expect(closed).toContainEqual({ kind: "closed" });
    expect(tear.snapshot().phase).toBe("closed");
    expect(runFor(tear, 1000)).toEqual([]);
  });

  it("ignores blows aimed at snippers that are not its own", () => {
    const tear = opened();
    const other = servantOf(opened());
    expect(tear.hurt(other, 5, HEART)).toBe(false);
  });
});
