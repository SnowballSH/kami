import { describe, expect, it } from "vitest";
import type { Vec } from "../../core/geometry";
import { blob, line } from "../../sim/testSupport";
import { PuzzleRun } from "./testSupport";

const GROUND = 560;

const ring = (centre: Vec): Vec[] =>
  Array.from({ length: 25 }, (_, i) => ({
    x: centre.x + 24 * Math.cos((i / 24) * Math.PI * 2),
    y: centre.y + 30 * Math.sin((i / 24) * Math.PI * 2),
  }));

describe("The Wall", () => {
  it("cannot be climbed or jumped, and ink named anything but bouncy stays ink", async () => {
    const run = new PuzzleRun("puzzle-wall");
    expect(run.staging.world.inkEater).toBe(1);
    expect(run.play(1_500)).toBe(false);
    expect(run.feet.x).toBeLessThan(720);
    const ladder = await run.draw(
      "ladder",
      "a ladder",
      line({ x: 560, y: GROUND }, { x: 560, y: GROUND - 200 }),
    );
    expect(ladder?.nature).toBe("ink");
  });

  it("is crossed by one bouncy drawing at the foot of the wall", async () => {
    const run = new PuzzleRun("puzzle-wall");
    const spring = await run.draw("spring", "a trampoline", blob(680, GROUND, 70, 30));
    expect(spring?.nature).toBe("bouncy");
    expect(run.play()).toBe(true);
  });
});

describe("The Keyhole", () => {
  it("stops her at the crack while she is her own size", () => {
    const run = new PuzzleRun("puzzle-keyhole");
    expect(run.play(1_500)).toBe(false);
    expect(run.feet.x).toBeLessThan(600);
  });

  it("lets her under once she is written tiny", async () => {
    const run = new PuzzleRun("puzzle-keyhole");
    expect(await run.write("alice is tiny")).not.toBeNull();
    expect(run.physics.aliceSize).toBe(0.5);
    expect(run.play()).toBe(true);
  });

  it("will not hear about gravity", async () => {
    const run = new PuzzleRun("puzzle-keyhole");
    expect(await run.write("we are on the moon")).not.toBeNull();
    expect(run.physics.gravity.y).toBe(1);
  });
});

describe("The Moon Ledge", () => {
  it("is too high a hop under Earth gravity, and nothing drawn takes a nature", async () => {
    const run = new PuzzleRun("puzzle-moon-ledge");
    expect(run.play(1_500)).toBe(false);
    const spring = await run.draw("spring", "a trampoline", blob(600, GROUND, 70, 30));
    expect(spring?.nature).toBe("ink");
  });

  it("is hopped once we are on the moon", async () => {
    const run = new PuzzleRun("puzzle-moon-ledge");
    expect(await run.write("we are on the moon")).not.toBeNull();
    expect(run.physics.gravity.y).toBeCloseTo(0.165);
    expect(run.play()).toBe(true);
  });
});

describe("The Dark Hall", () => {
  it("keeps her still in the dark", () => {
    const run = new PuzzleRun("puzzle-dark-hall");
    expect(run.physics.daylight).toBe(0);
    run.run(300);
    expect(run.seen.some((event) => event.type === "in-the-dark")).toBe(true);
    expect(run.feet.x).toBeCloseTo(140, 0);
  });

  it("is walked lantern to lantern", async () => {
    const run = new PuzzleRun("puzzle-dark-hall");
    for (const [n, x] of [300, 700, 1000].entries()) {
      const lamp = await run.draw(`lamp-${n}`, "a lantern", blob(x, 420, 40, 40));
      expect(lamp?.nature).toBe("lantern");
    }
    expect(run.play()).toBe(true);
  });
});

describe("The Twin Doors", () => {
  it("holds her in the box with one portal", async () => {
    const run = new PuzzleRun("puzzle-twin-doors");
    const door = await run.draw("door", "a portal", ring({ x: 300, y: GROUND - 34 }));
    expect(door?.nature).toBe("portal");
    expect(run.play(1_500)).toBe(false);
    expect(run.feet.x).toBeLessThan(400);
  });

  it("lets her out through a pair of portals", async () => {
    const run = new PuzzleRun("puzzle-twin-doors");
    await run.draw("in", "a portal", ring({ x: 300, y: GROUND - 34 }));
    await run.draw("out", "a portal", ring({ x: 700, y: GROUND - 34 }));
    expect(run.play()).toBe(true);
    expect(run.seen.some((event) => event.type === "warped")).toBe(true);
  });
});

describe("The Shaft", () => {
  it("is not climbed", () => {
    const run = new PuzzleRun("puzzle-shaft");
    expect(run.play(1_500)).toBe(false);
  });

  it("is flown once she can fly", async () => {
    const run = new PuzzleRun("puzzle-shaft");
    expect(await run.write("alice can fly")).not.toBeNull();
    expect(run.physics.flight).toBe(1);
    expect(run.play()).toBe(true);
  });
});

describe("The Pit", () => {
  it("is not cleared by a spring alone, nor by the moon alone", async () => {
    const withSpring = new PuzzleRun("puzzle-pit");
    await withSpring.draw("spring", "a spring", blob(300, GROUND, 60, 30));
    expect(withSpring.play(2_000)).toBe(false);

    const onTheMoon = new PuzzleRun("puzzle-pit");
    await onTheMoon.write("we are on the moon");
    expect(onTheMoon.play(2_000)).toBe(false);
  });

  it("is cleared by a spring under moon gravity", async () => {
    const run = new PuzzleRun("puzzle-pit");
    await run.draw("spring", "a spring", blob(300, GROUND, 60, 30));
    await run.write("we are on the moon");
    expect(run.play()).toBe(true);
  });
});

describe("the Sumikui", () => {
  it("is loose in every room until banished", async () => {
    const run = new PuzzleRun("puzzle-wall");
    expect(run.physics.inkEater).toBe(1);
    expect(run.world.sumikui).not.toBeNull();
    expect(await run.write("banish the ink eater")).not.toBeNull();
    expect(run.physics.inkEater).toBe(0);
    expect(run.world.sumikui).toBeNull();
  });

  it("leaves the one drawing a room needs alone for ten seconds", async () => {
    const run = new PuzzleRun("puzzle-wall");
    await run.draw("spring", "a trampoline", blob(680, GROUND, 70, 30));
    run.run(600);
    expect(run.has("spring")).toBe(true);
  });
});
