import { beforeEach, describe, expect, it } from "vitest";
import { createAutopilot } from "../autopilot";
import { createCat } from "../cat";
import type { Vec } from "../core/geometry";
import { FIXED_STEP_MS } from "../core/world";
import { createInkSession, findDrawingAt, mintDrawingId } from "../ink";
import { createSimulation } from "../sim";
import { Game } from "./game";
import { LEVELS } from "./levels";
import { FakeHud, FakeRenderer } from "./testing/fakes";

const COMMIT_WAIT_MS = 1_200;
const ROOM_TIMEOUT_MS = 40_000;

const line = (from: Vec, to: Vec, spacing = 8): Vec[] => {
  const count = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / spacing);
  return Array.from({ length: count + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / count,
    y: from.y + ((to.y - from.y) * i) / count,
  }));
};

const blob = (center: Vec, rx: number, ry: number): Vec[] =>
  Array.from({ length: 25 }, (_, i) => ({
    x: center.x + rx * Math.cos((i / 24) * Math.PI * 2),
    y: center.y + ry * Math.sin((i / 24) * Math.PI * 2),
  }));

class Player {
  readonly renderer = new FakeRenderer();
  readonly game: Game;
  private hudRef: FakeHud | null = null;
  private nowMs = 0;

  constructor() {
    this.game = new Game({
      levels: LEVELS,
      sim: createSimulation(),
      cat: createCat(),
      autopilot: createAutopilot(),
      renderer: this.renderer,
      createInkSession,
      createHud: (handlers) => {
        this.hudRef = new FakeHud(handlers);
        return this.hudRef;
      },
      findDrawingAt,
      mintDrawingId,
    });
    this.game.start(0);
  }

  get hud(): FakeHud {
    if (this.hudRef === null) throw new Error("HUD was never created");
    return this.hudRef;
  }

  get room(): string | undefined {
    return this.hud.rooms.at(-1);
  }

  async wait(ms: number): Promise<void> {
    const end = this.nowMs + ms;
    while (this.nowMs < end) await this.frame();
  }

  async waitUntil(done: () => boolean, timeoutMs = ROOM_TIMEOUT_MS): Promise<boolean> {
    const end = this.nowMs + timeoutMs;
    while (!done() && this.nowMs < end) await this.frame();
    return done();
  }

  async draw(points: readonly Vec[]): Promise<void> {
    const [first, ...rest] = points;
    if (first === undefined) return;
    this.game.penDown(first);
    for (const point of rest) this.game.penMove(point);
    this.game.penUp();
    await this.wait(COMMIT_WAIT_MS);
  }

  async drawAndName(points: readonly Vec[], name: string): Promise<void> {
    await this.draw(points);
    expect(await this.waitUntil(() => this.hud.namingOpen, 2_000)).toBe(true);
    this.game.onNameChosen(name);
    await this.wait(100);
  }

  walk(x: -1 | 0 | 1, y: -1 | 0 | 1 = 0): void {
    this.game.onWalkIntent({ x, y });
  }

  get alice() {
    const frame = this.renderer.lastFrame;
    if (frame === null) throw new Error("nothing rendered yet");
    return frame.world.alice;
  }

  private async frame(): Promise<void> {
    this.nowMs += FIXED_STEP_MS;
    this.game.frame(this.nowMs);
    await Promise.resolve();
  }
}

describe("Game, played headlessly through every room", () => {
  let player: Player;

  beforeEach(() => {
    player = new Player();
  });

  it("opens on the Riverbank with a full pen", async () => {
    await player.wait(50);
    expect(player.room).toBe("The Riverbank");
    expect(player.hud.ink).toEqual({ total: 600, remaining: 600 });
    expect(player.hud.said).toContain("She can't jump. Draw.");
  });

  it("spends ink while drawing and refunds it on erase", async () => {
    await player.draw(line({ x: 370, y: 556 }, { x: 610, y: 556 }));
    expect(player.hud.ink.remaining).toBeCloseTo(360, 0);
    expect(player.renderer.lastFrame?.inks).toHaveLength(1);

    player.game.onEraserToggled(true);
    player.game.penDown({ x: 500, y: 558 });
    player.game.penUp();
    await player.wait(50);
    expect(player.hud.ink.remaining).toBeCloseTo(600, 0);
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
  });

  it("lets Alice walk, wait short of the ledge, then cross a bridge on her own", async () => {
    await player.wait(3_000);
    expect(player.alice.center.x).toBeGreaterThan(200);
    expect(player.alice.center.x).toBeLessThan(300);
    expect(player.renderer.lastFrame?.aliceWaiting).toBe(true);
    expect(player.hud.said).toContain("She has gone as far as she can. Draw her a way on.");

    await player.draw(line({ x: 370, y: 556 }, { x: 610, y: 556 }));
    expect(await player.waitUntil(() => player.room === "The Shelves")).toBe(true);
  });

  it("is completable by drawing alone: bridge, bouncy mushroom, cake, key, bottle, door", async () => {
    await player.draw(line({ x: 370, y: 556 }, { x: 610, y: 556 }));
    expect(await player.waitUntil(() => player.room === "The Shelves")).toBe(true);
    expect(player.hud.cards.map((card) => card.title)).toEqual(["Kami"]);

    await player.drawAndName(blob({ x: 640, y: 620 }, 30, 18), "a bouncy mushroom");
    expect(player.renderer.lastFrame?.inks[0]?.nature).toBe("bouncy");
    expect(await player.waitUntil(() => player.room === "The Hall of Doors")).toBe(true);

    await player.drawAndName(blob({ x: 430, y: 624 }, 18, 14), "a cake");
    expect(await player.waitUntil(() => player.alice.size === "big")).toBe(true);
    expect(await player.waitUntil(() => player.renderer.lastFrame?.world.keyTaken === true)).toBe(
      true,
    );

    await player.drawAndName(blob({ x: 560, y: 624 }, 18, 14), "drink me");
    expect(await player.waitUntil(() => player.hud.ending !== null)).toBe(true);
    expect(player.hud.ending?.map((entry) => entry.name)).toEqual([
      "just ink",
      "a bouncy mushroom",
      "a cake",
      "drink me",
    ]);
  });

  it("still obeys the keyboard as a manual override", async () => {
    await player.draw(line({ x: 370, y: 556 }, { x: 610, y: 556 }));
    player.walk(1);
    expect(await player.waitUntil(() => player.room === "The Shelves")).toBe(true);
    expect(player.hud.cards.map((card) => card.title)).toEqual(["Kami"]);

    player.walk(0);
    await player.drawAndName(blob({ x: 640, y: 620 }, 30, 18), "a bouncy mushroom");
    expect(player.renderer.lastFrame?.inks[0]?.nature).toBe("bouncy");
    player.walk(1);
    expect(await player.waitUntil(() => player.room === "The Hall of Doors")).toBe(true);

    player.walk(0);
    await player.drawAndName(blob({ x: 430, y: 624 }, 18, 14), "a cake");
    player.walk(1);
    expect(
      await player.waitUntil(() => player.renderer.lastFrame?.world.alice.size === "big"),
    ).toBe(true);
    player.walk(-1);
    expect(await player.waitUntil(() => player.renderer.lastFrame?.world.keyTaken === true)).toBe(
      true,
    );

    player.walk(0);
    await player.drawAndName(blob({ x: 560, y: 624 }, 18, 14), "drink me");
    player.walk(1);
    expect(await player.waitUntil(() => player.hud.ending !== null)).toBe(true);
    expect(player.hud.ending?.map((entry) => entry.name)).toEqual([
      "just ink",
      "a bouncy mushroom",
      "a cake",
      "drink me",
    ]);
  });
});
