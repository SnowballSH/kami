import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutopilot } from "../autopilot";
import { boardFor } from "../board";
import { createCat } from "../cat";
import { poseToWorld, rectsOverlap, type Vec } from "../core/geometry";
import { INPUT_LIMITS, TEXT_LIMIT_MESSAGE } from "../core/inputLimits";
import { FIXED_STEP_MS } from "../core/world";
import { createInkSession, findDrawingAt } from "../ink";
import type { BoardSnapshot, HandwritingReader } from "../persistence/types";
import { createPenReader } from "../reading";
import type { Completion, LiveRecognizer, Sighting } from "../recognition/types";
import { createRuleCompiler, resolvePhysics } from "../rules";
import type { CompiledRule } from "../rules/types";
import { createSimulation } from "../sim";
import { drawingOf } from "../sim/testSupport";
import type { Tool } from "../ui/types";
import { Game } from "./game";
import { HELD_INK_FADE_MS } from "./heldInk";
import {
  RULE_REPEALED_LINE,
  SUMIKUI_LORE_LINE_DELAY_MS,
  SUMIKUI_SEALED_LINE,
  SUMIKUI_SUMMONED_LINES,
} from "./lines";
import {
  FakeHandwriting,
  FakeHud,
  FakeLawsPanel,
  FakeRenderer,
  MemoryBoardStore,
} from "./testing/fakes";

const COMMIT_WAIT_MS = 1_200;
const PATIENCE_MS = 40_000;

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

type Thoughts = Readonly<Record<string, CompiledRule | Promise<CompiledRule | null>>>;

interface PlayerOptions {
  readonly store?: MemoryBoardStore;
  readonly thoughts?: Thoughts;
  readonly eyes?: LiveRecognizer;
  readonly reader?: HandwritingReader;
}

const seen = (word: string, nature: Sighting["nature"], certain = false): Sighting => ({
  word,
  confidence: 0.9,
  name: `${/^[aeiou]/.test(word) ? "an" : "a"} ${word}`,
  nature,
  strength: 1,
  line: `That is ${word}, plainly.`,
  certain,
});

/** Eyes that glimpse one thing while the pen is up and settle on another when the drawing is done. */
class Eyes implements LiveRecognizer {
  readonly asked: { readonly strokes: number; readonly partial: boolean }[] = [];

  constructor(
    private readonly glimpsed: readonly Sighting[],
    private readonly settled: readonly Sighting[],
  ) {}

  recognize(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }

  sight(strokes: readonly unknown[], options?: { readonly partial?: boolean }) {
    const partial = options?.partial === true;
    this.asked.push({ strokes: strokes.length, partial });
    return Promise.resolve(partial ? this.glimpsed : this.settled);
  }

  /** How Kami would tidy whatever is sent; null leaves the player's ink alone. */
  tidy: ((strokes: readonly Vec[][]) => Completion | null) | null = null;
  readonly tidiedAs: (string | undefined)[] = [];

  complete(strokes: readonly Vec[][], name?: string): Promise<Completion | null> {
    this.tidiedAs.push(name);
    return Promise.resolve(this.tidy?.(strokes) ?? null);
  }
}

/** Short vertical strokes side by side: what a scrawled word looks like to the ink session. */
const scrawl = (at: Vec, letters: number, spacing = 14): Vec[][] =>
  Array.from({ length: letters }, (_, i) => [
    { x: at.x + i * spacing, y: at.y },
    { x: at.x + i * spacing + 6, y: at.y + 12 },
    { x: at.x + i * spacing, y: at.y + 24 },
  ]);

/** Reads any scrawl of at least three strokes as the given words, after a delay in frames. */
class ScriptedReader implements HandwritingReader {
  readonly asked: number[] = [];
  readonly pending: (() => void)[] = [];

  constructor(
    private readonly says: string | null,
    private readonly slow = false,
  ) {}

  read(strokes: readonly Vec[][]): Promise<string | null> {
    this.asked.push(strokes.length);
    const answer = strokes.length >= 3 ? this.says : null;
    if (!this.slow) return Promise.resolve(answer);
    return new Promise((resolve) => this.pending.push(() => resolve(answer)));
  }

  answerAll(): void {
    for (const reply of this.pending.splice(0)) reply();
  }
}

class Player {
  readonly sim = createSimulation();
  readonly renderer = new FakeRenderer();
  readonly store: MemoryBoardStore;
  readonly game: Game;
  private hudRef: FakeHud | null = null;
  private lawsRef: FakeLawsPanel | null = null;
  private nowMs = 0;

  readonly pondered: string[] = [];

  constructor(
    boardId: string,
    { store = new MemoryBoardStore(), thoughts = {}, eyes, reader }: PlayerOptions = {},
  ) {
    this.store = store;
    this.game = new Game(
      {
        sim: this.sim,
        autopilot: createAutopilot(),
        cat: createCat(eyes),
        ...(eyes === undefined ? {} : { finisher: eyes }),
        renderer: this.renderer,
        handwriting: new FakeHandwriting(),
        compiler: createRuleCompiler(),
        thinker: {
          compile: (text) => {
            this.pondered.push(text);
            return Promise.resolve(thoughts[text] ?? null);
          },
        },
        store,
        ...(reader === undefined ? {} : { penReader: createPenReader(reader) }),
        resolvePhysics,
        boardFor,
        createInkSession,
        createHud: (handlers) => {
          this.hudRef = new FakeHud(handlers);
          return this.hudRef;
        },
        createLawsPanel: (handlers) => {
          this.lawsRef = new FakeLawsPanel(handlers);
          return this.lawsRef;
        },
        findDrawingAt,
      },
      boardId,
    );
  }

  get hud(): FakeHud {
    if (this.hudRef === null) throw new Error("HUD was never created");
    return this.hudRef;
  }

  get laws(): FakeLawsPanel {
    if (this.lawsRef === null) throw new Error("Laws panel was never created");
    return this.lawsRef;
  }

  get written(): readonly string[] {
    return this.renderer.lastFrame?.notes.map((note) => note.script.text) ?? [];
  }

  get alice() {
    const alice = this.renderer.lastFrame?.world.alice;
    if (alice === undefined) throw new Error("Nothing has been rendered yet");
    return alice;
  }

  async arrive(): Promise<void> {
    await this.game.start(0);
    await this.wait(50);
  }

  async wait(ms: number): Promise<void> {
    const end = this.nowMs + ms;
    while (this.nowMs < end) await this.frame();
  }

  async until(done: () => boolean, timeoutMs = PATIENCE_MS): Promise<boolean> {
    const end = this.nowMs + timeoutMs;
    while (!done() && this.nowMs < end) await this.frame();
    return done();
  }

  use(tool: Tool): void {
    this.game.onToolChanged(tool);
  }

  async draw(points: readonly Vec[]): Promise<void> {
    this.use("draw");
    const [first, ...rest] = points;
    if (first === undefined) return;
    this.game.penDown(first);
    for (const point of rest) this.game.penMove(point);
    this.game.penUp();
    await this.wait(COMMIT_WAIT_MS);
  }

  async scrawl(strokes: readonly Vec[][]): Promise<void> {
    this.use("draw");
    for (const stroke of strokes) {
      const [first, ...rest] = stroke;
      if (first === undefined) continue;
      this.game.penDown(first);
      for (const point of rest) this.game.penMove(point);
      this.game.penUp();
      await this.wait(50);
    }
    await this.wait(COMMIT_WAIT_MS);
  }

  async write(text: string, at: Vec): Promise<void> {
    this.use("write");
    this.hud.willWrite(text);
    this.game.tap(at);
    await this.wait(100);
  }

  async erase(at: Vec): Promise<void> {
    this.use("erase");
    this.game.penDown(at);
    this.game.penUp();
    await this.wait(50);
  }

  walk(x: -1 | 0 | 1, y: -1 | 0 | 1 = 0): void {
    this.game.onWalkIntent({ x, y });
  }

  private async frame(): Promise<void> {
    this.nowMs += FIXED_STEP_MS;
    this.game.frame(this.nowMs);
    await Promise.resolve();
  }
}

describe("Game on the Wonderland board", () => {
  let player: Player;

  beforeEach(async () => {
    player = new Player("wonderland");
    await player.arrive();
  });

  it.each([
    { angle: Math.PI / 2, at: { x: 1000, y: 1180 }, competingY: 1120 },
    { angle: -Math.PI / 2, at: { x: 1000, y: 800 }, competingY: 860 },
    { angle: 0, at: { x: 1190, y: 1000 }, competingY: 1100 },
  ])(
    "names the nearest drawing under a full pose with angle $angle",
    async ({ angle, at, competingY }) => {
      const target = drawingOf("target", [
        { x: 300, y: 300 },
        { x: 700, y: 300 },
      ]);
      const competitor = drawingOf("competitor", [
        { x: at.x, y: competingY },
        { x: at.x + 40, y: competingY },
      ]);
      player.game.onCommit(target);
      player.game.onCommit(competitor);
      const snapshot = player.sim.snapshot();
      vi.spyOn(player.sim, "snapshot").mockReturnValue({
        ...snapshot,
        drawings: snapshot.drawings.map((drawing) => ({
          ...drawing,
          pose:
            drawing.id === target.id
              ? { origin: { x: 500, y: 300 }, position: { x: 1000, y: 1000 }, angle }
              : { origin: { x: 0, y: 0 }, position: { x: 0, y: 0 }, angle: 0 },
        })),
      });

      await player.write("a rock", at);

      const { drawings } = await player.store.load("wonderland");
      expect(drawings.find(({ drawing }) => drawing.id === target.id)?.ruling?.name).toBe("a rock");
      expect(drawings.find(({ drawing }) => drawing.id === competitor.id)?.ruling).toBeNull();
    },
  );

  it("opens with Kami's wordmark and the first zone's line written on the board", () => {
    expect(player.written).toContain("kami");
    expect(player.written).toContain("She can hop, not fly. You can draw.");
    expect(player.hud.boards.map((board) => board.id)).toContain("wonderland");
  });

  it("offers three tappable guesses beside a fresh drawing, and a tap names it", async () => {
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.wait(100);
    const guesses = player.renderer.lastFrame?.notes.filter((note) => note.tappable) ?? [];
    expect(guesses).toHaveLength(3);

    const [first] = guesses;
    if (first === undefined) throw new Error("no guess to tap");
    const { x, y, width, height } = first.script.bounds;
    player.game.tap({ x: x + width / 2, y: y + height / 2 });
    await player.wait(100);

    expect(player.renderer.lastFrame?.notes.filter((note) => note.tappable)).toHaveLength(0);
    const [stored] = (await player.store.load("wonderland")).drawings;
    expect(stored?.ruling?.name).toBe(first.script.text.replace(/\?$/, ""));
  });

  it("turns a written law into physics, remembers it, and repeals it when erased", async () => {
    await player.write("set g equal to the moon's gravity", { x: 200, y: 200 });
    const remembered = (await player.store.load("wonderland")).rules;
    expect(remembered).toHaveLength(1);
    expect(remembered[0]?.effect).toMatchObject({ governs: "gravity" });
    expect(player.written.some((text) => text.startsWith("kami: gravity"))).toBe(true);

    await player.erase({ x: 210, y: 215 });
    expect((await player.store.load("wonderland")).rules).toHaveLength(0);
    expect(player.written.some((text) => text.startsWith("kami: gravity"))).toBe(false);
  });

  it("rejects oversized notes before drawing or persisting them", async () => {
    const tooLong = "x".repeat(INPUT_LIMITS.text + 1);
    await player.write(tooLong, { x: 200, y: 200 });
    expect(player.written.some((text) => text.includes(tooLong))).toBe(false);
    expect(player.written.some((text) => text.includes(TEXT_LIMIT_MESSAGE))).toBe(true);
    expect((await player.store.load("wonderland")).notes).toHaveLength(0);
  });

  it("lists the standing laws in order, and a tap on one repeals it and erases its note", async () => {
    await player.write("set g equal to the moon's gravity", { x: 200, y: 200 });
    await player.write("it is night", { x: 200, y: 300 });
    expect(player.laws.laws.map((law) => law.text)).toEqual([
      "set g equal to the moon's gravity",
      "it is night",
    ]);
    expect(player.laws.laws[0]?.gloss).toMatch(/gravity/);

    const [gravity] = player.laws.laws;
    if (gravity === undefined) throw new Error("no law to repeal");
    player.laws.handlers.onRepealLaw(gravity.id);
    await player.wait(50);
    expect(player.laws.laws.map((law) => law.text)).toEqual(["it is night"]);
    expect(player.written).not.toContain("set g equal to the moon's gravity");
    expect(player.written).toContain(RULE_REPEALED_LINE);
    expect((await player.store.load("wonderland")).rules.map((rule) => rule.sourceText)).toEqual([
      "it is night",
    ]);

    const returning = new Player("wonderland", { store: player.store });
    await returning.arrive();
    expect(returning.laws.laws.map((law) => law.text)).toEqual(["it is night"]);
  });

  it("stops the lore mid-recital when the Sumikui is sealed within moments of summoning", async () => {
    await player.write("summon the ink eater", { x: 200, y: 200 });
    await player.erase({ x: 210, y: 215 });
    expect(player.written).toContain(SUMIKUI_SEALED_LINE);
    const unspoken = SUMIKUI_SUMMONED_LINES.slice(1);
    await player.wait(SUMIKUI_LORE_LINE_DELAY_MS * SUMIKUI_SUMMONED_LINES.length + 100);
    for (const line of unspoken) expect(player.written).not.toContain(line);
  });

  it("places the lore below the toolbar without overlapping the intro or earlier notes", async () => {
    player.hud.toolbarBottomY = 350;
    await player.write("summon the ink eater", { x: 200, y: 200 });
    await player.wait(SUMIKUI_LORE_LINE_DELAY_MS * 2 + 100);
    const notes = player.renderer.lastFrame?.notes ?? [];
    const lore = notes.filter((note) => SUMIKUI_SUMMONED_LINES.includes(note.script.text));
    expect(lore).toHaveLength(SUMIKUI_SUMMONED_LINES.length);
    for (const note of lore) {
      expect(note.script.bounds.y).toBeGreaterThan(player.hud.toolbarBottomY);
      expect(
        notes.some(
          (other) => other.id !== note.id && rectsOverlap(note.script.bounds, other.script.bounds),
        ),
      ).toBe(false);
    }
  });

  it("summons the Sumikui with its lore, keeps it while the law stands, and seals it when erased", async () => {
    await player.write("summon the ink eater", { x: 200, y: 200 });
    expect(player.renderer.lastFrame?.world.sumikui).not.toBeNull();
    expect(player.written).toContain("kami: the Sumikui, the ink eater, is loose");
    expect(player.written).toContain(SUMIKUI_SUMMONED_LINES[0]);
    await player.wait(SUMIKUI_LORE_LINE_DELAY_MS * 2 + 100);
    for (const line of SUMIKUI_SUMMONED_LINES) expect(player.written).toContain(line);

    await player.erase({ x: 210, y: 215 });
    expect(player.renderer.lastFrame?.world.sumikui).toBeNull();
    expect(player.written).toContain(SUMIKUI_SEALED_LINE);
    expect(player.written).not.toContain(RULE_REPEALED_LINE);
  });

  it("shrugs at writing that is neither a law nor near a drawing", async () => {
    await player.write("hello there", { x: 200, y: 100 });
    expect((await player.store.load("wonderland")).rules).toHaveLength(0);
    expect(player.written).toContain("hello there");
    expect(player.written.length).toBeGreaterThan(3);
  });

  it("never writes one note on top of another", async () => {
    await player.write("set g equal to the moon's gravity", { x: 200, y: 200 });
    await player.write("slow motion", { x: 200, y: 240 });
    await player.write("hello there", { x: 200, y: 280 });
    await player.write("hello again", { x: 200, y: 320 });

    const notes = player.renderer.lastFrame?.notes ?? [];
    expect(notes.length).toBeGreaterThan(6);
    const bounds = notes.map((note) => note.script.bounds);
    for (const [i, a] of bounds.entries()) {
      for (const b of bounds.slice(i + 1)) expect(rectsOverlap(a, b)).toBe(false);
    }
  });

  it("brings a board back from memory", async () => {
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.write("a rock", { x: 250, y: 450 });
    await player.write("no gravity", { x: 200, y: 200 });

    const returning = new Player("wonderland", { store: player.store });
    await returning.arrive();
    expect(returning.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual(["heavy"]);
    expect(returning.written).toContain("a rock");
    expect(returning.written).toContain("no gravity");
    expect(returning.written.some((text) => text.startsWith("kami: gravity"))).toBe(true);
  });

  it("restores legacy labels without inventing a drawing association", async () => {
    player.game.onAutopilotToggled(false);
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.write("a rock", { x: 250, y: 450 });
    const saved = await player.store.load("wonderland");
    const label = saved.notes[0];
    const drawing = saved.drawings[0]?.drawing;
    if (label === undefined || drawing === undefined) throw new Error("no named drawing");
    const { drawingId: _drawingId, ...legacy } = label;
    player.store.saveNote("wonderland", legacy);
    const returning = new Player("wonderland", { store: player.store });
    returning.game.onAutopilotToggled(false);
    await returning.arrive();
    const pose = returning.renderer.lastFrame?.world.drawings[0];
    const point = drawing.strokes[0]?.[0];
    if (pose === undefined || point === undefined) throw new Error("no drawing to erase");
    await returning.erase(poseToWorld(point, pose.pose));
    expect(returning.written).toContain("a rock");
    expect(await player.store.load("wonderland")).toEqual({
      drawings: [],
      notes: [legacy],
      rules: [],
    });
  });

  it("is completable start to goal: bridge, bouncy mushroom, cake, key, bottle, door", async () => {
    await player.draw(line({ x: 370, y: 556 }, { x: 610, y: 556 }));
    await player.draw(blob({ x: 1430, y: 540 }, 30, 18));
    await player.write("a bouncy mushroom", { x: 1380, y: 440 });
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toContain("bouncy");

    player.walk(1);
    expect(await player.until(() => player.alice.center.x > 1740 && player.alice.grounded)).toBe(
      true,
    );
    expect(player.written).toContain("Curiouser and curiouser.");

    player.walk(0);
    await player.draw(blob({ x: 2150, y: 324 }, 18, 14));
    await player.write("a cake", { x: 2120, y: 250 });
    player.walk(1);
    expect(await player.until(() => player.alice.size === "big")).toBe(true);
    player.walk(-1);
    expect(await player.until(() => player.alice.hasKey)).toBe(true);

    player.walk(0);
    await player.draw(blob({ x: 2300, y: 324 }, 18, 14));
    await player.write("drink me", { x: 2270, y: 250 });
    player.walk(1);
    expect(
      await player.until(() => player.written.some((text) => text.includes("rabbit hole"))),
    ).toBe(true);
    expect((await player.store.load("wonderland")).drawings.map((d) => d.ruling?.name)).toEqual([
      undefined,
      "a bouncy mushroom",
    ]);
  });
});

describe.each(["live", "reloaded"])("drawing labels on a %s board", (state) => {
  const resume = async (player: Player, boardId: string): Promise<Player> => {
    if (state === "live") return player;
    const returning = new Player(boardId, { store: player.store });
    returning.game.onAutopilotToggled(false);
    await returning.arrive();
    return returning;
  };

  describe.each(["typed", "unknown", "certain", "certain ink", "guess"])("%s label", (source) => {
    it.each(["rename", "erase"])("removes the old label on %s", async (action) => {
      let player = new Player("wonderland", {
        eyes: new Eyes(
          [],
          [seen("rock", source === "certain ink" ? "ink" : "heavy", source.startsWith("certain"))],
        ),
      });
      player.game.onAutopilotToggled(false);
      await player.arrive();
      await player.draw(blob({ x: 300, y: 530 }, 30, 20));
      if (source === "guess") {
        expect((await player.store.load("wonderland")).notes).toEqual([]);
        const guess = player.renderer.lastFrame?.notes.find((note) => note.tappable);
        if (guess === undefined) throw new Error("no guess to accept");
        const { x, y } = guess.script.bounds;
        player.game.tap({ x, y });
        await player.wait(100);
      } else if (!source.startsWith("certain")) {
        await player.write(source === "unknown" ? "my friend gerald" : "a rock", {
          x: 250,
          y: 450,
        });
      }
      const saved = await player.store.load("wonderland");
      expect(saved.notes).toHaveLength(1);
      const label = saved.notes[0];
      const drawing = saved.drawings[0]?.drawing;
      if (label === undefined || drawing === undefined) throw new Error("no named drawing");
      expect(label.drawingId).toBe(drawing.id);
      expect(label.fleeting).toBe(false);
      expect(label.action).toBeUndefined();

      player = await resume(player, "wonderland");
      expect(player.written).toContain(label.text);
      if (action === "rename") await player.write("a cloud", { x: 250, y: 400 });
      else {
        const pose = player.renderer.lastFrame?.world.drawings.find((d) => d.id === drawing.id);
        const point = drawing.strokes[0]?.[0];
        if (pose === undefined || point === undefined) throw new Error("no drawing to erase");
        await player.erase(poseToWorld(point, pose.pose));
      }
      expect(player.written).not.toContain(label.text);
      const remaining = await player.store.load("wonderland");
      expect(remaining.notes.map((note) => note.text)).toEqual(
        action === "rename" ? ["a cloud"] : [],
      );
      if (action === "rename") expect(remaining.notes[0]?.drawingId).toBe(drawing.id);
      const returning = new Player("wonderland", { store: player.store });
      await returning.arrive();
      expect(returning.written).not.toContain(label.text);
    });
  });

  it("removes a consumed cake's label from the board and memory", async () => {
    let player = new Player("wonderland");
    player.game.onAutopilotToggled(false);
    await player.arrive();
    await player.draw(blob({ x: 260, y: 540 }, 18, 14));
    await player.write("a cake", { x: 230, y: 450 });
    player = await resume(player, "wonderland");
    expect(player.written).toContain("a cake");
    player.walk(1);
    expect(await player.until(() => player.alice.size === "big")).toBe(true);
    expect(player.written).not.toContain("a cake");
    expect(await player.store.load("wonderland")).toEqual({ drawings: [], notes: [], rules: [] });
    const returning = new Player("wonderland", { store: player.store });
    await returning.arrive();
    expect(returning.written).not.toContain("a cake");
  });

  it("removes a devoured drawing's label while retaining the ink-eater law", async () => {
    const boardId = "hungry-board";
    let player = new Player(boardId);
    player.game.onAutopilotToggled(false);
    await player.arrive();
    await player.draw(blob({ x: 60, y: -5 }, 24, 24));
    await player.write("a rock", { x: 40, y: -100 });
    const rock = (await player.store.load(boardId)).drawings[0]?.drawing;
    if (rock === undefined) throw new Error("no rock");
    await player.draw(blob({ x: 240, y: -5 }, 24, 24));
    await player.write("summon the ink eater", { x: 800, y: -300 });
    player = await resume(player, boardId);
    expect(player.written).toContain("a rock");
    player.walk(1);
    await player.wait(750);
    player.walk(0);
    expect(
      await player.until(
        () => !player.renderer.lastFrame?.world.drawings.some((d) => d.id === rock.id),
      ),
    ).toBe(true);
    expect(player.written).not.toContain("a rock");
    const saved = await player.store.load(boardId);
    expect(saved.drawings).toHaveLength(1);
    expect(saved.notes.map((note) => note.text)).toEqual(["summon the ink eater"]);
    expect(saved.rules).toHaveLength(1);
    const returning = new Player(boardId, { store: player.store });
    await returning.arrive();
    expect(returning.written).not.toContain("a rock");
    expect(returning.laws.laws.map((law) => law.text)).toEqual(["summon the ink eater"]);
  });
});

describe("Alice on her own", () => {
  let player: Player;

  beforeEach(async () => {
    player = new Player("wonderland");
    await player.arrive();
  });

  it("walks to the ditch, stops short of it, and says so", async () => {
    expect(await player.until(() => player.alice.center.x > 150)).toBe(true);
    expect(
      await player.until(() => player.written.some((text) => text.includes("Draw her one"))),
    ).toBe(true);
    await player.wait(3_000);
    expect(player.alice.center.x).toBeGreaterThan(150);
    expect(player.alice.center.x).toBeLessThan(380);
    expect(player.alice.grounded).toBe(true);
  });

  it("crosses all of Wonderland with nothing but drawings", async () => {
    await player.draw(line({ x: 370, y: 556 }, { x: 610, y: 556 }));
    expect(await player.until(() => player.alice.center.x > 700)).toBe(true);

    await player.draw(blob({ x: 1430, y: 540 }, 30, 18));
    await player.write("a bouncy mushroom", { x: 1380, y: 440 });
    expect(await player.until(() => player.alice.center.x > 1740 && player.alice.grounded)).toBe(
      true,
    );

    await player.draw(blob({ x: 2150, y: 324 }, 18, 14));
    await player.write("a cake", { x: 2120, y: 250 });
    expect(await player.until(() => player.alice.size === "big")).toBe(true);
    expect(await player.until(() => player.alice.hasKey)).toBe(true);

    await player.draw(blob({ x: 2300, y: 324 }, 18, 14));
    await player.write("drink me", { x: 2270, y: 250 });
    expect(
      await player.until(() => player.written.some((text) => text.includes("rabbit hole"))),
    ).toBe(true);
  });

  it("hops over a fire drawn across her path", async () => {
    await player.draw(blob({ x: 260, y: 550 }, 10, 10));
    await player.write("fire", { x: 230, y: 480 });
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toContain("hazard");

    expect(await player.until(() => !player.alice.grounded && player.alice.center.x > 200)).toBe(
      true,
    );
    expect(await player.until(() => player.alice.center.x > 300 && player.alice.grounded)).toBe(
      true,
    );
  });

  it("stays put when the player switches her self-walking off, and sets off again when it is back on", async () => {
    const player = new Player("wonderland");
    await player.arrive();
    player.game.onAutopilotToggled(false);
    expect(player.hud.autopilot).toBe(false);
    const parked = player.alice.center.x;
    await player.wait(1_500);
    expect(player.alice.center.x).toBeCloseTo(parked, 0);

    player.game.onAutopilotToggled(true);
    expect(await player.until(() => player.alice.center.x > parked + 60, 6_000)).toBe(true);
  });

  it("yields to the keyboard while a key is held", async () => {
    player.walk(-1);
    await player.wait(1_000);
    expect(player.alice.center.x).toBeLessThan(100);
    player.walk(0);
    expect(await player.until(() => player.alice.center.x > 150)).toBe(true);
  });
});

describe("Game with a model to think with", () => {
  afterEach(() => vi.restoreAllMocks());

  const RED_PLANET = "make it feel like the red planet";
  const MARS: CompiledRule = {
    effect: { governs: "gravity", x: 0, y: 0.38 },
    explanation: "gravity = 0.38 g (Mars)",
  };

  it("orders same-millisecond laws by submission through late responses, reload and repeal", async () => {
    const pending = Promise.withResolvers<CompiledRule | null>();
    const store = new MemoryBoardStore();
    const player = new Player("wonderland", {
      store,
      thoughts: { "a custom sky": pending.promise },
    });
    await player.arrive();
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    await player.write("a custom sky", { x: 200, y: 100 });
    await player.write("night", { x: 200, y: 200 });
    expect(player.renderer.lastFrame?.daylight).toBe(0.1);
    pending.resolve({ effect: { governs: "daylight", value: 1 }, explanation: "daylight" });
    await player.wait(100);
    expect(player.renderer.lastFrame?.daylight).toBe(0.1);
    const snapshot = await store.load("wonderland");
    const ordered = snapshot.rules.toSorted((a, b) => a.createdAt - b.createdAt);
    expect(ordered.map((rule) => rule.sourceText)).toEqual(["a custom sky", "night"]);
    expect(ordered.map((rule) => rule.createdAt)).toEqual([1_000, 1_001]);
    for (const rule of ordered) {
      expect(rule.createdAt).toBe(
        snapshot.notes.find((note) => note.id === rule.noteId)?.createdAt,
      );
    }

    const reloaded = new Player("wonderland", { store });
    await reloaded.arrive();
    expect(reloaded.renderer.lastFrame?.daylight).toBe(0.1);
    const night = reloaded.renderer.lastFrame?.notes.find((note) => note.script.text === "night");
    if (night === undefined) throw new Error("night note missing");
    await reloaded.erase({ x: night.script.bounds.x + 1, y: night.script.bounds.y + 1 });
    expect(reloaded.renderer.lastFrame?.daylight).toBe(1);
    await reloaded.write("night", { x: 200, y: 300 });
    const newest = (await store.load("wonderland")).rules.find(
      (rule) => rule.sourceText === "night",
    );
    expect(newest?.createdAt).toBe(1_002);
    expect(reloaded.renderer.lastFrame?.daylight).toBe(0.1);
  });

  it("asks the model only about what nothing else understood", async () => {
    const player = new Player("wonderland", { thoughts: { [RED_PLANET]: MARS } });
    await player.arrive();

    await player.write("no friction", { x: 200, y: 100 });
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.write("a bouncy mushroom", { x: 250, y: 450 });
    expect(player.pondered).toEqual([]);

    await player.write(RED_PLANET, { x: 200, y: 200 });
    expect(player.pondered).toEqual([RED_PLANET]);
    expect(player.written).toContain("kami: gravity = 0.38 g (Mars)");
    expect(player.written).not.toContain("hmm...");
    expect((await player.store.load("wonderland")).rules.map((rule) => rule.sourceText)).toEqual([
      "no friction",
      RED_PLANET,
    ]);
  });

  it("still labels a drawing when the model has no idea either", async () => {
    const player = new Player("wonderland");
    await player.arrive();
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.write("my friend gerald", { x: 250, y: 450 });
    expect(player.pondered).toEqual(["my friend gerald"]);
    const [stored] = (await player.store.load("wonderland")).drawings;
    expect(stored?.ruling).toMatchObject({ nature: "ink" });
  });
});

describe("Game with Kami's eyes on the ink", () => {
  const sketch = async (player: Player, points: readonly Vec[]): Promise<void> => {
    player.use("draw");
    const [first, ...rest] = points;
    if (first === undefined) return;
    player.game.penDown(first);
    for (const point of rest) player.game.penMove(point);
    player.game.penUp();
    await player.wait(50);
  };

  it("pencils in a guess between strokes, keeps quiet on nothing, and clears it once the ink settles", async () => {
    const eyes = new Eyes([seen("mushroom", "bouncy")], []);
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await sketch(player, blob({ x: 300, y: 530 }, 30, 20));
    expect(player.written).toContain("a mushroom?");
    expect(eyes.asked).toEqual([{ strokes: 1, partial: true }]);

    await sketch(player, line({ x: 270, y: 530 }, { x: 330, y: 530 }));
    expect(player.written.filter((text) => text === "a mushroom?")).toHaveLength(1);
    expect(eyes.asked.at(-1)).toEqual({ strokes: 2, partial: true });

    await player.wait(COMMIT_WAIT_MS);
    const notes = player.renderer.lastFrame?.notes ?? [];
    expect(notes.filter((note) => note.script.text === "a mushroom?" && !note.tappable)).toEqual(
      [],
    );
    expect(eyes.asked.at(-1)).toEqual({ strokes: 2, partial: false });
    expect(notes.filter((note) => note.tappable)).toHaveLength(3);
  });

  it("labels a drawing himself when he is certain, and lets a written name overrule him", async () => {
    const eyes = new Eyes([], [seen("okapi", "walker", true), seen("zebra", "walker")]);
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.wait(100);
    expect(player.written).toContain("an okapi");
    expect(player.renderer.lastFrame?.notes.filter((note) => note.tappable)).toHaveLength(0);
    const [stored] = (await player.store.load("wonderland")).drawings;
    expect(stored?.ruling).toMatchObject({ name: "an okapi", nature: "walker" });
    expect((await player.store.load("wonderland")).notes.map((note) => note.text)).toEqual([
      "an okapi",
    ]);

    await player.write("a rock", { x: 300, y: 470 });
    expect(player.written).not.toContain("an okapi");
    const [renamed] = (await player.store.load("wonderland")).drawings;
    expect(renamed?.ruling).toMatchObject({ name: "a rock", nature: "heavy" });
    expect((await player.store.load("wonderland")).notes.map((note) => note.text)).toEqual([
      "a rock",
    ]);
  });

  it("offers guesses as usual when he is not certain", async () => {
    const player = new Player("wonderland", {
      eyes: new Eyes([], [seen("okapi", "walker"), seen("zebra", "walker")]),
    });
    await player.arrive();
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.wait(100);
    const guesses = player.renderer.lastFrame?.notes.filter((note) => note.tappable) ?? [];
    expect(guesses.map((note) => note.script.text)).toEqual([
      "an okapi?",
      "a zebra?",
      "a mushroom?",
    ]);
  });

  it.each([
    seen("baseball bat", "ink"),
    seen("aircraft carrier", "heavy"),
    seen("baseball", "bouncy"),
    seen("asparagus", "grow"),
  ])("carries $word's offered ruling through a tap, simulation and storage", async (sighting) => {
    const offered = { ...sighting, strength: 1.7 };
    const player = new Player("wonderland", { eyes: new Eyes([], [offered]) });
    await player.arrive();
    await player.draw(blob({ x: 300, y: 430 }, 30, 20));
    await player.wait(100);
    const guess = player.renderer.lastFrame?.notes.find(
      (note) => note.tappable && note.script.text === `${offered.name}?`,
    );
    if (guess === undefined) throw new Error("No canonical guess to tap");
    const { x, y, width, height } = guess.script.bounds;
    player.game.tap({ x: x + width / 2, y: y + height / 2 });
    await player.wait(100);

    const expected = {
      name: offered.name,
      nature: offered.nature,
      strength: offered.strength,
      line: offered.line,
      tags: [],
    };
    const board = await player.store.load("wonderland");
    expect(board.drawings[0]?.ruling).toEqual(expected);
    expect(player.renderer.lastFrame?.inks[0]?.nature).toBe(offered.nature);
    expect(board.notes.some((note) => note.action !== undefined)).toBe(false);
    expect(player.renderer.lastFrame?.notes.filter((note) => note.tappable)).toHaveLength(0);
  });

  it("never auto-accepts a certain partial sighting", async () => {
    const player = new Player("wonderland", {
      eyes: new Eyes([seen("aircraft carrier", "heavy", true)], []),
    });
    await player.arrive();
    await sketch(player, blob({ x: 300, y: 430 }, 30, 20));
    expect((await player.store.load("wonderland")).drawings).toHaveLength(0);
    await player.wait(COMMIT_WAIT_MS);
    expect((await player.store.load("wonderland")).drawings[0]?.ruling).toBeNull();
    expect(player.renderer.lastFrame?.notes.filter((note) => note.tappable)).toHaveLength(3);
  });
});

describe("Game with a Kami who tidies", () => {
  const lifted = (strokes: readonly Vec[][]): Vec[][] =>
    strokes.map((stroke) => stroke.map(({ x, y }) => ({ x, y: y - 3 })));
  const flourish: Vec[] = [
    { x: 300, y: 480 },
    { x: 310, y: 470 },
    { x: 320, y: 480 },
  ];

  it("glides a named drawing into its tidied strokes, draws in what was missing, and saves it", async () => {
    const eyes = new Eyes([], [seen("mushroom", "bouncy", true)]);
    eyes.tidy = (strokes) => ({
      tidied: lifted(strokes),
      added: [flourish],
      word: "mushroom",
      confidence: 0.9,
    });
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    expect(eyes.tidiedAs).toEqual(["a mushroom"]);
    const drawn = (await player.store.load("wonderland")).drawings[0]?.drawing.strokes ?? [];
    expect(drawn).toHaveLength(2);
    expect(drawn[1]).toEqual(flourish);

    await player.wait(800);
    const shown = player.renderer.lastFrame?.inks[0]?.drawing.strokes ?? [];
    expect(shown).toEqual(drawn);
    expect(player.renderer.lastFrame?.inks[0]?.nature).toBe("bouncy");
  });

  it("shows the ink on its way there, never jumping", async () => {
    const eyes = new Eyes([], [seen("mushroom", "bouncy", true)]);
    eyes.tidy = (strokes) => ({
      tidied: lifted(strokes),
      added: [],
      word: "mushroom",
      confidence: 1,
    });
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    const saved = (await player.store.load("wonderland")).drawings[0]?.drawing.strokes ?? [];
    const onTheWay = player.renderer.lastFrame?.inks[0]?.drawing.strokes ?? [];
    const lift = (saved[0]?.[0]?.y ?? 0) - (onTheWay[0]?.[0]?.y ?? 0);
    expect(onTheWay[0]).toHaveLength(saved[0]?.length ?? -1);
    expect(Math.abs(lift)).toBeLessThanOrEqual(3);
  });

  it("tidies toward the name that stands, not one the player corrected meanwhile", async () => {
    const eyes = new Eyes([], [seen("mushroom", "bouncy", true)]);
    const answers: ((completion: Completion | null) => void)[] = [];
    eyes.complete = (strokes, name) => {
      eyes.tidiedAs.push(name);
      return new Promise((resolve) => {
        answers.push((completion) =>
          resolve(completion ?? { ...tidyAs(strokes), word: name ?? "" }),
        );
      });
    };
    const tidyAs = (strokes: readonly Vec[][]) => ({
      tidied: lifted(strokes),
      added: [],
      word: "",
      confidence: 1,
    });
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.write("a ladder", { x: 300, y: 500 });
    expect(eyes.tidiedAs).toEqual(["a mushroom"]);

    answers.shift()?.(null);
    await player.wait(50);
    expect(eyes.tidiedAs).toEqual(["a mushroom", "a ladder"]);
    const untouched = (await player.store.load("wonderland")).drawings[0]?.drawing.strokes ?? [];

    answers.shift()?.(null);
    await player.wait(50);
    const saved = (await player.store.load("wonderland")).drawings[0];
    expect(saved?.ruling?.nature).toBe("climbable");
    expect(saved?.drawing.strokes[0]?.[0]?.y).toBe((untouched[0]?.[0]?.y ?? 0) - 3);
  });

  it("leaves the player's ink exactly as drawn when Kami has nothing to offer", async () => {
    const eyes = new Eyes([], [seen("mushroom", "bouncy", true)]);
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.wait(800);
    expect(eyes.tidiedAs).toEqual(["a mushroom"]);
    const saved = (await player.store.load("wonderland")).drawings[0]?.drawing.strokes ?? [];
    expect(player.renderer.lastFrame?.inks[0]?.drawing.strokes).toEqual(saved);
    expect(saved).toHaveLength(1);
  });
});

describe("Game with a pen that reads", () => {
  it("reads a scrawl as words while the pen is still up, and never lands it as ink", async () => {
    const reader = new ScriptedReader("no gravity");
    const player = new Player("wonderland", { reader });
    await player.arrive();

    await player.scrawl(scrawl({ x: 200, y: 200 }, 4));
    expect(reader.asked).toEqual([1, 2, 3, 4]);
    expect(player.written).toContain("no gravity");
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    const board = await player.store.load("wonderland");
    expect(board.drawings).toHaveLength(0);
    expect(board.rules.map((rule) => rule.sourceText)).toEqual(["no gravity"]);
  });

  it("holds a scrawl weightless while the reading is out, then fades it away as words", async () => {
    const reader = new ScriptedReader("slow motion", true);
    const player = new Player("wonderland", { reader });
    await player.arrive();

    await player.scrawl(scrawl({ x: 200, y: 200 }, 3));
    expect((await player.store.load("wonderland")).drawings).toHaveLength(0);
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    expect(player.renderer.lastFrame?.heldInks.map((held) => held.opacity)).toEqual([1]);
    expect(player.written).not.toContain("slow motion");

    reader.answerAll();
    await player.wait(100);
    expect(player.written).toContain("slow motion");
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    const [fading] = player.renderer.lastFrame?.heldInks ?? [];
    expect(fading?.opacity).toBeGreaterThan(0);
    expect(fading?.opacity).toBeLessThan(1);
    await player.wait(HELD_INK_FADE_MS);
    expect(player.renderer.lastFrame?.heldInks).toHaveLength(0);
    const board = await player.store.load("wonderland");
    expect(board.drawings).toHaveLength(0);
    expect(board.rules.map((rule) => rule.sourceText)).toEqual(["slow motion"]);
  });

  it("lets held ink down into the world once the reader has seen no words in it", async () => {
    const reader = new ScriptedReader(null, true);
    const player = new Player("wonderland", { reader });
    await player.arrive();

    await player.scrawl(scrawl({ x: 200, y: 200 }, 3));
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    expect(player.renderer.lastFrame?.heldInks).toHaveLength(1);

    reader.answerAll();
    await player.wait(100);
    expect(player.renderer.lastFrame?.heldInks).toHaveLength(0);
    expect(player.renderer.lastFrame?.inks).toHaveLength(1);
    expect((await player.store.load("wonderland")).drawings).toHaveLength(1);
  });

  it("does not let Kami name ink he is sure about while the reader may still call it words", async () => {
    const reader = new ScriptedReader("no gravity", true);
    const eyes = new Eyes([], [seen("snake", "slippery", true)]);
    const player = new Player("wonderland", { reader, eyes });
    await player.arrive();

    await player.scrawl(scrawl({ x: 200, y: 200 }, 3));
    expect(player.renderer.lastFrame?.heldInks).toHaveLength(1);
    expect(player.written).not.toContain("a snake");

    reader.answerAll();
    await player.wait(100);
    expect(player.written).toContain("no gravity");
    expect(player.written).not.toContain("a snake");
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
  });

  it("lets Kami name it himself once the reader has seen no words in it", async () => {
    const reader = new ScriptedReader("never said", true);
    const eyes = new Eyes([], [seen("snake", "slippery", true)]);
    const player = new Player("wonderland", { reader, eyes });
    await player.arrive();

    await player.scrawl(scrawl({ x: 200, y: 200 }, 2));
    expect(player.written).not.toContain("a snake");

    reader.answerAll();
    await player.wait(100);
    expect(player.written).toContain("a snake");
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual(["slippery"]);
  });

  it("leaves a drawing alone when the reader sees no words, and does not bother it with a line", async () => {
    const reader = new ScriptedReader("never");
    const player = new Player("wonderland", { reader });
    await player.arrive();

    await player.draw(line({ x: 370, y: 556 }, { x: 610, y: 556 }));
    expect(reader.asked).toEqual([]);
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    expect(reader.asked).toEqual([1]);
    expect((await player.store.load("wonderland")).drawings).toHaveLength(2);
    expect(player.written).not.toContain("never");
  });
});

describe("Game while a board is loading", () => {
  it("pauses simulation and rejects drawing, naming, law and erase input until restore", async () => {
    const store = new MemoryBoardStore();
    const original = new Player("wonderland", { store });
    await original.arrive();
    await original.draw(blob({ x: 300, y: 530 }, 30, 20));
    await original.write("night", { x: 200, y: 200 });
    const snapshot = await store.load("wonderland");
    const pending = Promise.withResolvers<BoardSnapshot>();
    vi.spyOn(store, "load").mockReturnValueOnce(pending.promise);
    const player = new Player("wonderland", { store });
    const arrival = player.arrive();
    const prompt = vi.spyOn(player.hud, "promptText");
    await player.wait(50);
    const center = player.alice.center;
    await player.draw(blob({ x: 400, y: 530 }, 30, 20));
    player.use("write");
    player.game.tap({ x: 200, y: 200 });
    player.game.tap({ x: 300, y: 450 });
    await player.erase({ x: 300, y: 530 });
    expect(prompt).not.toHaveBeenCalled();
    expect(player.alice.center).toEqual(center);
    expect(player.written).toContain("Loading board…");
    expect(await store.load("wonderland")).toEqual(snapshot);

    pending.resolve(snapshot);
    await arrival;
    expect(player.renderer.lastFrame?.daylight).toBe(0.1);
    expect(player.renderer.lastFrame?.inks).toHaveLength(1);
    expect(player.written).not.toContain("Loading board…");
    await player.write("day", { x: 200, y: 300 });
    expect((await store.load("wonderland")).notes.some((note) => note.text === "day")).toBe(true);
  });

  it("keeps the new board locked when an older board finishes loading", async () => {
    const store = new MemoryBoardStore();
    const first = Promise.withResolvers<BoardSnapshot>();
    const second = Promise.withResolvers<BoardSnapshot>();
    vi.spyOn(store, "load").mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const player = new Player("first", { store });
    const arrival = player.arrive();
    player.game.onOpenBoard("second");
    first.resolve({ drawings: [], notes: [], rules: [] });
    await arrival;
    const prompt = vi.spyOn(player.hud, "promptText");
    player.use("write");
    player.game.tap({ x: 200, y: 200 });
    expect(prompt).not.toHaveBeenCalled();
    expect(player.written).toContain("Loading board…");
    second.resolve({ drawings: [], notes: [], rules: [] });
    await player.wait(50);
    await player.write("night", { x: 200, y: 200 });
    expect((await store.load("second")).rules).toHaveLength(1);
  });

  it("allows clearing during load and ignores the old snapshot after new edits", async () => {
    const store = new MemoryBoardStore();
    const original = new Player("wonderland", { store });
    await original.arrive();
    await original.draw(blob({ x: 300, y: 530 }, 30, 20));
    const snapshot = await store.load("wonderland");
    const pending = Promise.withResolvers<BoardSnapshot>();
    vi.spyOn(store, "load").mockReturnValueOnce(pending.promise);
    const player = new Player("wonderland", { store });
    const arrival = player.arrive();
    player.game.onClearBoard();
    await player.write("night", { x: 200, y: 200 });
    pending.resolve(snapshot);
    await arrival;
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    expect(player.renderer.lastFrame?.daylight).toBe(0.1);
    expect((await store.load("wonderland")).rules).toHaveLength(1);
  });
});

describe("Game on a blank board", () => {
  it("makes a new game out of sketches and notes", async () => {
    const player = new Player("my-first-game");
    await player.arrive();

    await player.draw(line({ x: 200, y: -40 }, { x: 700, y: -40 }));
    await player.write("platform", { x: 400, y: -130 });
    await player.draw(blob({ x: 650, y: -80 }, 16, 16));
    await player.write("goal", { x: 640, y: -170 });
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual(["solid", "goal"]);

    player.walk(1);
    expect(
      await player.until(() => player.written.some((text) => text.includes("rabbit hole"))),
    ).toBe(true);
  });
});
