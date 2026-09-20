import { describe, expect, it } from "vitest";
import { blob, line } from "../../sim/testSupport";
import { PuzzleRun } from "./testSupport";

const GROUND = 560;

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
