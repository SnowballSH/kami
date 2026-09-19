import { beforeEach, describe, expect, it } from "vitest";
import { createAutopilot } from "../autopilot";
import { boardFor } from "../board";
import { createCat } from "../cat";
import { rectsOverlap, type Stroke, type Vec } from "../core/geometry";
import { FIXED_STEP_MS } from "../core/world";
import { createInkSession, findDrawingAt } from "../ink";
import type { HandwritingReader } from "../persistence/types";
import { createPenReader } from "../reading";
import type { Completion, LiveRecognizer, Sighting } from "../recognition/types";
import { createRuleCompiler, resolvePhysics } from "../rules";
import type { CompiledRule } from "../rules/types";
import { createSimulation } from "../sim";
import type { Tool } from "../ui/types";
import { Game } from "./game";
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

type Thoughts = Readonly<Record<string, CompiledRule>>;

interface PlayerOptions {
  readonly store?: MemoryBoardStore;
  readonly thoughts?: Thoughts;
  readonly eyes?: LiveRecognizer;
  readonly reader?: HandwritingReader;
  readonly completer?: Pick<LiveRecognizer, "complete">;
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

  complete(): Promise<null> {
    return Promise.resolve(null);
  }
}

/** Short vertical strokes side by side: what a scrawled word looks like to the ink session. */
const scrawl = (at: Vec, letters: number): Vec[][] =>
  Array.from({ length: letters }, (_, i) => [
    { x: at.x + i * 14, y: at.y },
    { x: at.x + i * 14 + 6, y: at.y + 12 },
    { x: at.x + i * 14, y: at.y + 24 },
  ]);

/** Reads any scrawl of at least three strokes as the given words, after a delay in frames. */
class ScriptedReader implements HandwritingReader {
  readonly asked: number[] = [];
  readonly pending: (() => void)[] = [];

  constructor(
    private readonly says: string,
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
  readonly renderer = new FakeRenderer();
  readonly store: MemoryBoardStore;
  readonly game: Game;
  private hudRef: FakeHud | null = null;
  private lawsRef: FakeLawsPanel | null = null;
  private nowMs = 0;

  readonly pondered: string[] = [];

  constructor(
    boardId: string,
    { store = new MemoryBoardStore(), thoughts = {}, eyes, reader, completer }: PlayerOptions = {},
  ) {
    this.store = store;
    this.game = new Game(
      {
        sim: createSimulation(),
        autopilot: createAutopilot(),
        cat: createCat(eyes),
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
        ...(completer === undefined ? {} : { completer }),
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
  const RED_PLANET = "make it feel like the red planet";
  const MARS: CompiledRule = {
    effect: { governs: "gravity", x: 0, y: 0.38 },
    explanation: "gravity = 0.38 g (Mars)",
  };

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

  it("lifts a landed drawing into words when the reading comes in late", async () => {
    const reader = new ScriptedReader("slow motion", true);
    const player = new Player("wonderland", { reader });
    await player.arrive();

    await player.scrawl(scrawl({ x: 200, y: 200 }, 3));
    expect((await player.store.load("wonderland")).drawings).toHaveLength(1);
    expect(player.written).not.toContain("slow motion");

    reader.answerAll();
    await player.wait(100);
    expect(player.written).toContain("slow motion");
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    const board = await player.store.load("wonderland");
    expect(board.drawings).toHaveLength(0);
    expect(board.rules.map((rule) => rule.sourceText)).toEqual(["slow motion"]);
  });

  it("does not let Kami name ink he is sure about while the reader may still call it words", async () => {
    const reader = new ScriptedReader("no gravity", true);
    const eyes = new Eyes([], [seen("snake", "slippery", true)]);
    const player = new Player("wonderland", { reader, eyes });
    await player.arrive();

    await player.scrawl(scrawl({ x: 200, y: 200 }, 3));
    expect(player.renderer.lastFrame?.inks).toHaveLength(1);
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

class FinishingPen {
  readonly requests: {
    readonly strokes: readonly Stroke[];
    readonly name: string | undefined;
    readonly reply: (completion: Completion | null) => void;
  }[] = [];

  complete(strokes: readonly Stroke[], name?: string): Promise<Completion | null> {
    return new Promise((reply) => this.requests.push({ strokes, name, reply }));
  }
}

const prepareCompletion = async () => {
  const completer = new FinishingPen();
  const player = new Player("completion", { completer });
  await player.arrive();
  await player.draw(line({ x: 200, y: -40 }, { x: 700, y: -40 }));
  await player.write("platform", { x: 400, y: -130 });
  const original = (await player.store.load("completion")).drawings[0];
  const request = completer.requests[0];
  if (original === undefined || request === undefined) throw new Error("no completion requested");
  const completion: Completion = {
    tidied: request.strokes.map((stroke) => stroke.map((p) => ({ x: p.x, y: p.y + 4 }))),
    added: [
      [
        { x: 700, y: -36 },
        { x: 700, y: -100 },
      ],
    ],
    word: "platform",
    confidence: 0.9,
  };
  return { player, completer, original, request, completion };
};

describe("Game ink completion", () => {
  it("animates a named drawing and persists its replacement with the same id and ruling", async () => {
    const { player, completer, original, request, completion } = await prepareCompletion();
    expect(request.name).toBe(original.ruling?.name);
    request.reply(completion);
    await player.wait(100);
    const moving = player.renderer.lastFrame?.inks[0];
    expect(moving?.drawing.strokes).not.toEqual(original.drawing.strokes);
    expect(moving?.drawing.strokes).not.toEqual([...completion.tidied, ...completion.added]);
    expect((await player.store.load("completion")).drawings).toEqual([original]);
    await player.wait(1_600);
    expect((await player.store.load("completion")).drawings).toEqual([
      {
        drawing: { ...original.drawing, strokes: [...completion.tidied, ...completion.added] },
        ruling: original.ruling,
      },
    ]);
    expect(player.renderer.lastFrame?.inks[0]?.nature).toBe("solid");
    expect(completer.requests).toHaveLength(1);
  });

  it("leaves the original ink intact when completion declines", async () => {
    const { player, original, request } = await prepareCompletion();
    request.reply(null);
    await player.wait(1_600);
    expect((await player.store.load("completion")).drawings).toEqual([original]);
    expect(player.renderer.lastFrame?.inks[0]?.drawing).toEqual(original.drawing);
  });

  it("ignores a reply from a prior visit even when the same drawing id is restored", async () => {
    const { player, original, request, completion } = await prepareCompletion();
    player.game.onOpenBoard("elsewhere");
    await player.wait(50);
    player.game.onOpenBoard("completion");
    await player.wait(50);
    request.reply(completion);
    await player.wait(1_600);
    expect((await player.store.load("completion")).drawings).toEqual([original]);
  });

  it("ignores an old reply after renaming and cancels an animation when erased", async () => {
    const { player, completer, request, completion } = await prepareCompletion();
    await player.write("wall", { x: 400, y: -130 });
    const renamed = (await player.store.load("completion")).drawings[0];
    request.reply(completion);
    await player.wait(1_600);
    expect((await player.store.load("completion")).drawings).toEqual([renamed]);
    const latest = completer.requests[1];
    if (latest === undefined) throw new Error("no completion for renamed ink");
    latest.reply(completion);
    await player.wait(100);
    await player.erase({ x: 400, y: -40 });
    await player.wait(1_600);
    expect((await player.store.load("completion")).drawings).toEqual([]);
    expect(player.renderer.lastFrame?.inks).toEqual([]);
  });
});
