import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutopilot } from "../autopilot";
import { boardFor } from "../board";
import { ENDLESS_STRIP as ENDLESS_GROUND, endlessPage } from "../board/boards/endless";
import { createCat } from "../cat";
import { OFFER_HELP } from "../cat/lines";
import { boundsOf, poseToWorld, rectsOverlap, type Stroke, type Vec } from "../core/geometry";
import { INPUT_LIMITS, TEXT_LIMIT_MESSAGE } from "../core/inputLimits";
import { FIXED_STEP_MS } from "../core/world";
import { BRIDGE_LINE, DROP_LINE, IDEAS, LADDER_LINE } from "../counsel";
import { createInkSession, findDrawingAt } from "../ink";
import type { InkSession } from "../ink/types";
import {
  BOSS_MODE,
  EMBODIED_MODE,
  FIRST_PUZZLE_BOARD_ID,
  NOTHING_HUNGRY_LINE,
  PUZZLE_MODE,
  PUZZLE_ROOMS,
  SANDBOX_MODE,
} from "../modes";
import type { GameMode } from "../modes/types";
import { HttpBoardStore } from "../persistence/httpBoardStore";
import type { BoardSnapshot, BoardStore, HandwritingReader } from "../persistence/types";
import { createPenReader } from "../reading";
import type { Completion, Exemplar, LiveRecognizer, Sighting } from "../recognition/types";
import { createRuleCompiler, createSceneCompiler, resolvePhysics } from "../rules";
import type { CompiledRule, Scene } from "../rules/types";
import { createSimulation } from "../sim";
import { figureAround, legsBelow, ringAround } from "../sim/boss/figure.testSupport";
import { drawingOf } from "../sim/testSupport";
import { type SketchCatalogue, SUMMONED_SIZE, Summoner } from "../summoning";
import type { BoardLink } from "../sync/boardLink";
import { SharedPage } from "../sync/testing/sharedPage";
import type { PeerId } from "../sync/wire";
import { roomCardShownMs } from "../ui/roomCard";
import { titleCardShownMs } from "../ui/titleCard";
import type { Tool } from "../ui/types";
import {
  HEART_SWALLOWED_LINE,
  INCARNATED_LINE,
  INCARNATED_PARTS_LINE,
  IS_THIS_HER_LINE,
  PART_RESTORED_LINE,
  SERVANT_CAME_LINE,
  SOUL_WAITS_LINE,
  TEAR_OPENS_LINES,
} from "./bossLines";
import { ForgetfulBoardStore } from "./forgetfulStore";
import { Game, MAX_REMARKS } from "./game";
import { HELD_INK_FADE_MS } from "./heldInk";
import {
  CANNOT_DRAW_LINE,
  FELL_OFF_PAGE_LINE,
  LAW_OUTSIDE_MODE_LINE,
  NOWHERE_LINE,
  PERISHED_LINES,
  PONDERING_LINE,
  RULE_REPEALED_LINE,
  SUMIKUI_LORE_LINE_DELAY_MS,
  SUMIKUI_SEALED_LINE,
  SUMIKUI_SUMMONED_LINES,
  TAGLINE,
  WORDMARK,
} from "./lines";
import { NOTE_STYLE, type NoteBook } from "./noteBook";
import { ARRIVAL_MS } from "./retrace";
import {
  FakeHandwriting,
  FakeHud,
  FakeLawsPanel,
  FakeRenderer,
  MemoryBoardStore,
} from "./testing/fakes";

const COMMIT_WAIT_MS = 1_200;

const bossPaceBody = (heart: Vec): readonly Stroke[] => {
  const line = (from: Vec, to: Vec): Stroke =>
    Array.from({ length: 13 }, (_, i) => ({
      x: from.x + ((to.x - from.x) * i) / 12,
      y: from.y + ((to.y - from.y) * i) / 12,
    }));
  const cx = heart.x;
  const cy = heart.y;
  return [
    line({ x: cx - 16, y: cy - 22 }, { x: cx + 16, y: cy - 22 }),
    line({ x: cx + 16, y: cy - 22 }, { x: cx + 16, y: cy + 18 }),
    line({ x: cx + 16, y: cy + 18 }, { x: cx - 16, y: cy + 18 }),
    line({ x: cx - 16, y: cy + 18 }, { x: cx - 16, y: cy - 22 }),
    line({ x: cx - 10, y: cy + 18 }, { x: cx - 14, y: cy + 64 }),
    line({ x: cx + 10, y: cy + 18 }, { x: cx + 14, y: cy + 64 }),
    line({ x: cx - 16, y: cy - 15 }, { x: cx - 45, y: cy + 5 }),
    line({ x: cx + 16, y: cy - 15 }, { x: cx + 45, y: cy + 5 }),
    Array.from({ length: 17 }, (_, i) => ({
      x: cx + 13 * Math.cos((i / 16) * 2 * Math.PI),
      y: cy - 36 + 13 * Math.sin((i / 16) * 2 * Math.PI),
    })),
  ];
};
const PATIENCE_MS = 40_000;

const line = (from: Vec, to: Vec, spacing = 8): Vec[] => {
  const count = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / spacing);
  return Array.from({ length: count + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / count,
    y: from.y + ((to.y - from.y) * i) / count,
  }));
};

const cardLineOf = ({ card }: GameMode): string => `${card.title} — ${card.tagline}`;

const blob = (center: Vec, rx: number, ry: number): Vec[] =>
  Array.from({ length: 25 }, (_, i) => ({
    x: center.x + rx * Math.cos((i / 24) * Math.PI * 2),
    y: center.y + ry * Math.sin((i / 24) * Math.PI * 2),
  }));

const box = (bottomCentre: Vec, width: number, height: number): Vec[] => {
  const left = { x: bottomCentre.x - width / 2, y: bottomCentre.y };
  const right = { x: bottomCentre.x + width / 2, y: bottomCentre.y };
  const top = bottomCentre.y - height;
  return [
    ...line(left, { x: left.x, y: top }),
    ...line({ x: left.x, y: top }, { x: right.x, y: top }),
    ...line({ x: right.x, y: top }, right),
    ...line(right, left),
  ];
};

type Thoughts = Readonly<Record<string, CompiledRule | Promise<CompiledRule | null>>>;

interface PlayerOptions {
  readonly store?: BoardStore;
  readonly mode?: GameMode;
  readonly thoughts?: Thoughts;
  readonly eyes?: Eyes;
  readonly reader?: HandwritingReader;
  readonly farPlaces?: Readonly<Record<string, Scene>>;
  readonly link?: BoardLink;
  readonly shareLinkFor?: (boardId: string) => string;
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

/**
 * Eyes that glimpse one thing while the pen is up and settle on another when the drawing is done,
 * and that hold a picture of every word they are told about.
 */
class Eyes implements LiveRecognizer, SketchCatalogue {
  readonly asked: { readonly strokes: number; readonly partial: boolean }[] = [];

  constructor(
    private readonly glimpsed: readonly Sighting[],
    private readonly settled: readonly Sighting[],
    private readonly known: readonly string[] = [],
  ) {}

  categories(): Promise<readonly string[]> {
    return Promise.resolve(this.known);
  }

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

  complete(
    strokes: readonly Vec[][],
    name?: string,
    _firmness?: number,
  ): Promise<Completion | null> {
    this.tidiedAs.push(name);
    return Promise.resolve(this.tidy?.(strokes) ?? null);
  }

  /** Pictures Kami can draw himself, by the word asked for. */
  readonly pictures = new Map<string, Exemplar>();
  readonly summoned: string[] = [];

  exemplar(word: string): Promise<Exemplar | null> {
    this.summoned.push(word);
    const picture = this.pictures.get(word);
    if (picture !== undefined) return Promise.resolve(picture);
    return Promise.resolve(this.known.includes(word) ? { word, strokes: SQUARE } : null);
  }
}

const SQUARE: Exemplar["strokes"] = [
  [
    { x: 0, y: 0 },
    { x: 255, y: 0 },
    { x: 255, y: 255 },
    { x: 0, y: 255 },
    { x: 0, y: 0 },
  ],
];

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
  private readonly handwriting = new FakeHandwriting();
  readonly store: BoardStore;
  readonly game: Game;
  private hudRef: FakeHud | null = null;
  private inkRef: InkSession | null = null;
  private lawsRef: FakeLawsPanel | null = null;
  private nowMs = 0;

  readonly pondered: string[] = [];
  readonly travelled: string[] = [];

  constructor(
    boardId: string,
    {
      store = new MemoryBoardStore(),
      thoughts = {},
      eyes,
      reader,
      mode,
      farPlaces = {},
      link,
      shareLinkFor,
    }: PlayerOptions = {},
  ) {
    this.store = store;
    this.game = new Game(
      {
        sim: this.sim,
        autopilot: createAutopilot,
        cat: createCat(eyes),
        ...(eyes === undefined ? {} : { finisher: eyes, summoner: new Summoner(eyes, eyes) }),
        renderer: this.renderer,
        handwriting: this.handwriting,
        compiler: createRuleCompiler(),
        thinker: {
          compile: (text) => {
            this.pondered.push(text);
            return Promise.resolve(thoughts[text] ?? null);
          },
        },
        scenes: createSceneCompiler({
          compile: (text) => {
            this.travelled.push(text);
            return Promise.resolve(farPlaces[text] ?? null);
          },
        }),
        store,
        ...(reader === undefined ? {} : { penReader: createPenReader(reader) }),
        ...(mode === undefined ? {} : { mode }),
        resolvePhysics,
        boardFor,
        endlessPageFor: (id) => endlessPage(id, [ENDLESS_GROUND]),
        createInkSession: (listener) => {
          this.inkRef = createInkSession(listener);
          return this.inkRef;
        },
        createHud: (handlers) => {
          this.hudRef = new FakeHud(handlers);
          return this.hudRef;
        },
        createLawsPanel: (handlers) => {
          this.lawsRef = new FakeLawsPanel(handlers);
          return this.lawsRef;
        },
        findDrawingAt,
        ...(link === undefined ? {} : { link }),
        ...(shareLinkFor === undefined ? {} : { shareLinkFor }),
      },
      boardId,
    );
  }

  get hud(): FakeHud {
    if (this.hudRef === null) throw new Error("HUD was never created");
    return this.hudRef;
  }

  get ink(): InkSession {
    if (this.inkRef === null) throw new Error("Ink session was never created");
    return this.inkRef;
  }

  get laws(): FakeLawsPanel {
    if (this.lawsRef === null) throw new Error("Laws panel was never created");
    return this.lawsRef;
  }

  get everWritten(): readonly string[] {
    return this.handwriting.everWritten;
  }

  get written(): readonly string[] {
    return this.renderer.lastFrame?.notes.map((note) => note.script.text) ?? [];
  }

  get alice() {
    const alice = this.renderer.lastFrame?.world.alice;
    if (alice === undefined) throw new Error("Nothing has been rendered yet");
    if (alice === null) throw new Error("Nobody is on the board");
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

describe("Game during persistence outages", () => {
  it("keeps drawing and board navigation usable after load/list failure and recovers unsaved ink", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const saved = new MemoryBoardStore();
    let offline = true;
    const store = new HttpBoardStore(async (path, init) => {
      if (offline) throw new TypeError("offline");
      if (init?.method === "PUT") return Response.json({ ok: true });
      return Response.json(
        path === "/api/boards"
          ? { boards: [{ id: "remembered", drawings: 0, rules: 0 }] }
          : await saved.load("wonderland"),
      );
    });
    try {
      const player = new Player("wonderland", { store });
      await player.arrive();
      expect(player.hud.persistence?.errors.map(({ operation }) => operation)).toEqual([
        "load",
        "list",
      ]);
      await player.draw(blob({ x: 300, y: 530 }, 30, 20));
      await store.whenIdle();
      const local = await store.load("wonderland");
      expect(local.drawings).toHaveLength(1);
      player.game.onOpenBoard("elsewhere");
      await player.wait(100);
      expect(player.hud.boards.map(({ id }) => id)).toContain("wonderland");
      player.game.onOpenBoard("wonderland");
      await player.wait(100);
      expect(player.renderer.lastFrame?.world.drawings).toHaveLength(1);
      expect(player.hud.persistence?.unsaved).toBeGreaterThan(0);

      for (const entity of local.drawings) saved.saveDrawing("wonderland", entity);
      for (const entity of local.notes) saved.saveNote("wonderland", entity);
      offline = false;
      await player.game.onRetryPersistence();
      await player.wait(100);
      expect(player.renderer.lastFrame?.world.drawings).toHaveLength(1);
      expect(player.hud.persistence).toEqual({
        loading: false,
        saving: false,
        unsaved: 0,
        errors: [],
      });
      expect(player.hud.boards.map(({ id }) => id)).toContain("remembered");
    } finally {
      warn.mockRestore();
    }
  });

  it("tells the HUD nothing is kept when the store forgets everything", async () => {
    const player = new Player("wonderland", { store: new ForgetfulBoardStore() });
    await player.arrive();
    expect(player.hud.persistence).toBeNull();
  });

  it("does not reopen a board after retry completes on a different board", async () => {
    class RetryingStore extends MemoryBoardStore {
      readonly retrying = Promise.withResolvers<void>();
      override retry(): Promise<void> {
        return this.retrying.promise;
      }
    }
    const store = new RetryingStore();
    const player = new Player("wonderland", { store });
    await player.arrive();
    const retry = player.game.onRetryPersistence();
    player.game.onOpenBoard("elsewhere");
    await player.wait(100);
    store.retrying.resolve();
    await retry;
    expect(player.renderer.board?.id).toBe("elsewhere");
  });
});

describe("Game on the Wonderland board", () => {
  let player: Player;

  beforeEach(async () => {
    player = new Player("wonderland");
    await player.arrive();
  });

  it.each([
    { angle: Math.PI / 2, at: { x: 1000, y: 480 }, competingY: 420 },
    { angle: -Math.PI / 2, at: { x: 1000, y: 200 }, competingY: 260 },
    { angle: 0, at: { x: 1190, y: 480 }, competingY: 580 },
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
              ? {
                  origin: { x: 500, y: 300 },
                  position: {
                    x: 1000,
                    y: angle === Math.PI / 2 ? 300 : angle === -Math.PI / 2 ? 400 : 480,
                  },
                  angle,
                  scale: 1,
                }
              : { origin: { x: 0, y: 0 }, position: { x: 0, y: 0 }, angle: 0, scale: 1 },
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

  it("keeps a free Kami remark inside the visible world", () => {
    const write = (
      player.game as unknown as {
        kamiWrites: (
          text: string,
          position: Vec,
          options?: { lifetimeMs?: number },
        ) => {
          position: Vec;
        };
      }
    ).kamiWrites;
    const note = write.call(
      player.game,
      "right edge remark",
      { x: 1100, y: 100 },
      { lifetimeMs: 6_000 },
    );
    const right = player.renderer.viewport().width;
    expect(note.position.x).toBeLessThanOrEqual(right - NOTE_STYLE.kami.maxWidth - 24);
  });

  it("deduplicates and caps fleeting Kami remarks", async () => {
    player.game.onAutopilotToggled(false);
    const remark = (text: string): void =>
      (
        player.game as unknown as {
          remark: (line: string) => void;
        }
      ).remark(text);
    remark("same remark");
    remark("same remark");
    remark("second remark");
    remark("third remark");
    await player.wait(FIXED_STEP_MS);

    const same = () =>
      (player.renderer.lastFrame?.notes ?? []).filter(
        (note) => note.author === "kami" && note.script.text === "same remark",
      );
    expect(same()).toHaveLength(1);
    await player.wait(800);
    const opaque = (player.renderer.lastFrame?.notes ?? []).filter((note) => {
      const notebook = (player.game as unknown as { notes: NoteBook }).notes;
      return notebook.fleetingBy("kami").some(({ id }) => id === note.id) && note.opacity === 1;
    });
    expect(opaque.length).toBeLessThanOrEqual(2);
    expect(same()).toHaveLength(0);
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
    expect(lore.length).toBeLessThanOrEqual(MAX_REMARKS);
    expect(player.written).toContain(SUMIKUI_SUMMONED_LINES[1]);
    expect(player.written).toContain(SUMIKUI_SUMMONED_LINES[2]);
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
    expect(player.written).not.toContain(SUMIKUI_SUMMONED_LINES[0]);
    for (const line of SUMIKUI_SUMMONED_LINES.slice(1)) expect(player.written).toContain(line);

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

  it("says a word over ink the heat takes, once for a whole heatwave", async () => {
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.write("an ice cube", { x: 250, y: 450 });
    await player.draw(blob({ x: 500, y: 530 }, 30, 20));
    await player.write("an icicle", { x: 450, y: 450 });
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual([
      "slippery",
      "slippery",
    ]);

    await player.write("it's 100 degrees", { x: 200, y: 200 });
    expect(await player.until(() => player.renderer.lastFrame?.inks.length === 0)).toBe(true);
    const mourned = player.everWritten.filter((text) =>
      Object.values(PERISHED_LINES).some((lines) => lines.includes(text)),
    );
    expect(new Set(mourned)).toEqual(new Set([PERISHED_LINES.slippery?.[0]]));
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

  it("is completable from start to goal across Wonderland", async () => {
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
    await player.draw(blob({ x: 3490, y: 460 }, 30, 10));
    await player.write("a springy toadstool", { x: 3400, y: 400 });
    await player.draw(blob({ x: 3760, y: 324 }, 18, 14));
    await player.write("eat me", { x: 3730, y: 250 });
    player.walk(1);
    expect(await player.until(() => player.alice.size === "small")).toBe(true);
    expect(await player.until(() => player.alice.center.x > 2560)).toBe(true);
    expect(await player.until(() => player.alice.center.x > 3660 && player.alice.grounded)).toBe(
      true,
    );
    expect(await player.until(() => player.alice.size === "big")).toBe(true);
    expect(await player.until(() => player.alice.center.x > 4560 && player.alice.grounded)).toBe(
      true,
    );
    player.walk(1, -1);
    expect(await player.until(() => player.alice.center.x > 4620 && player.alice.grounded)).toBe(
      true,
    );

    player.walk(0);
    await player.draw(blob({ x: 5100, y: 194 }, 12, 15));
    await player.write("a bottle", { x: 5070, y: 120 });
    await player.draw(box({ x: 5975, y: 295 }, 130, 80));
    await player.write("an anvil", { x: 5940, y: 150 });
    player.walk(1);
    expect(await player.until(() => player.alice.size === "small")).toBe(true);
    expect(
      await player.until(() => player.written.some((text) => text.includes("rabbit hole"))),
    ).toBe(true);
    expect((await player.store.load("wonderland")).drawings.map((d) => d.ruling?.name)).toEqual([
      undefined,
      "a bouncy mushroom",
      "a springy toadstool",
      "an anvil",
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
    expect(saved.drawings).toHaveLength(0);
    expect(saved.notes.map((note) => note.text)).toEqual([]);
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
    await player.draw(blob({ x: 3490, y: 460 }, 30, 10));
    await player.write("a springy toadstool", { x: 3400, y: 400 });
    await player.draw(blob({ x: 3760, y: 324 }, 18, 14));
    await player.write("eat me", { x: 3730, y: 250 });
    await player.draw(blob({ x: 5100, y: 194 }, 12, 15));
    await player.write("a bottle", { x: 5070, y: 120 });
    await player.draw(box({ x: 5975, y: 295 }, 130, 80));
    await player.write("an anvil", { x: 5940, y: 150 });

    expect(await player.until(() => player.alice.center.x > 2560)).toBe(true);
    expect(await player.until(() => player.alice.center.x > 3660 && player.alice.grounded)).toBe(
      true,
    );
    expect(await player.until(() => player.alice.center.x > 4620 && player.alice.grounded)).toBe(
      true,
    );
    expect(await player.until(() => player.alice.size === "small")).toBe(true);
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
    expect(player.hud.autopilotOffered).toBe(true);
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
    await player.write("night", { x: 200, y: -200 });
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

  it("tidies what is already named again when the slider comes to rest, always from the ink as drawn", async () => {
    const eyes = new Eyes([], [seen("mushroom", "bouncy", true)]);
    const asked: { firstY: number; firmness: number | undefined }[] = [];
    eyes.complete = (strokes, _name, firmness) => {
      asked.push({ firstY: strokes[0]?.[0]?.y ?? Number.NaN, firmness });
      const lift = 10 * (firmness ?? 0);
      return Promise.resolve({
        tidied: strokes.map((stroke) => stroke.map(({ x, y }) => ({ x, y: y - lift }))),
        added: [],
        word: "mushroom",
        confidence: 1,
      });
    };
    const player = new Player("wonderland", { eyes });
    await player.arrive();
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    const drawnY = asked[0]?.firstY ?? Number.NaN;
    const savedY = async () =>
      (await player.store.load("wonderland")).drawings[0]?.drawing.strokes[0]?.[0]?.y;
    expect(await savedY()).toBeCloseTo(drawnY - 5);

    player.hud.handlers.onTidinessChanged(0.8);
    player.hud.handlers.onTidinessChanged(1);
    await player.wait(600);
    expect(asked.map(({ firmness }) => firmness)).toEqual([0.5, 1]);
    expect(asked[1]?.firstY).toBe(drawnY);
    expect(await savedY()).toBeCloseTo(drawnY - 10);

    player.hud.handlers.onTidinessChanged(0);
    await player.wait(600);
    expect(asked).toHaveLength(2);
    expect(await savedY()).toBe(drawnY);
  });

  it("tidies as firmly as the slider says, and not at all when it is all the way down", async () => {
    const eyes = new Eyes([], [seen("mushroom", "bouncy", true)]);
    const firmnesses: (number | undefined)[] = [];
    eyes.complete = (_strokes, _name, firmness) => {
      firmnesses.push(firmness);
      return Promise.resolve(null);
    };
    const player = new Player("wonderland", { eyes });
    await player.arrive();
    expect(player.hud.tidiness).toBe(0.5);

    player.hud.handlers.onTidinessChanged(0.9);
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    player.hud.handlers.onTidinessChanged(0);
    await player.draw(blob({ x: 500, y: 530 }, 30, 20));
    expect(firmnesses).toEqual([0.9]);
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

describe("Game with a Kami who draws", () => {
  const KNOWN = ["rabbit", "house", "tree", "cloud", "ladder"];
  const RABBIT: Exemplar = {
    word: "rabbit",
    strokes: [
      [
        { x: 20, y: 200 },
        { x: 120, y: 200 },
        { x: 220, y: 200 },
      ],
      [
        { x: 60, y: 200 },
        { x: 60, y: 40 },
      ],
      [
        { x: 180, y: 200 },
        { x: 180, y: 40 },
      ],
    ],
  };
  const drawer = () => {
    const eyes = new Eyes([], [], KNOWN);
    eyes.pictures.set("rabbit", RABBIT);
    return eyes;
  };

  it("takes a bare name beside unnamed ink as its name rather than drawing one", async () => {
    const eyes = drawer();
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.write("a ladder", { x: 300, y: 500 });
    expect(eyes.summoned).toEqual([]);
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual(["climbable"]);
  });

  it("draws what is asked for outright even beside unnamed ink, leaving that ink unnamed", async () => {
    const eyes = drawer();
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.write("summon a rabbit", { x: 300, y: 500 });
    expect(eyes.summoned).toEqual(["rabbit"]);
    const natures = player.renderer.lastFrame?.inks.map((ink) => ink.nature) ?? [];
    expect(natures).toContain("ink");
    expect(natures).toContain("hopper");
  });

  it("lets the player's words and Kami's label fade once they have been answered", async () => {
    const eyes = drawer();
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    const standing = player.written;
    await player.write("summon a rabbit", { x: 300, y: 500 });
    expect(player.written).toContain("summon a rabbit");
    expect(player.written.length).toBeGreaterThan(standing.length + 1);

    await player.wait(20_000);
    expect(player.written.filter((text) => !standing.includes(text))).toEqual([]);
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual(["hopper"]);
    expect((await player.store.load("wonderland")).notes).toEqual([]);
  });

  it("inks the picture asked for above the words, stroke by stroke, and names it", async () => {
    const eyes = drawer();
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.write("summon a rabbit", { x: 300, y: 500 });
    expect(eyes.summoned).toEqual(["rabbit"]);
    const onTheWay = player.renderer.lastFrame?.inks[0]?.drawing.strokes ?? [];
    expect(onTheWay.length).toBeLessThan(RABBIT.strokes.length);

    await player.wait(ARRIVAL_MS);
    const saved = (await player.store.load("wonderland")).drawings[0];
    expect(saved?.ruling?.nature).toBe("hopper");
    expect(saved?.drawing.strokes).toHaveLength(RABBIT.strokes.length);
    expect(player.renderer.lastFrame?.inks[0]?.drawing.strokes).toEqual(saved?.drawing.strokes);
    expect(player.sim.snapshot().drawings.map(({ id }) => id)).toEqual([saved?.drawing.id]);
    expect(eyes.tidiedAs).toEqual([]);

    const drawn = boundsOf(saved?.drawing.strokes.flat() ?? []);
    expect(Math.max(drawn.width, drawn.height)).toBeCloseTo(SUMMONED_SIZE.usual, 5);
    expect(drawn.y + drawn.height).toBeLessThan(500);
    expect(player.written).toContain("summon a rabbit");
    expect(player.written.some((text) => text !== "summon a rabbit")).toBe(true);
  });

  it("summons a whole scene in a row over the words, each thing named", async () => {
    const eyes = drawer();
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.write("a house, a tree and two clouds", { x: 300, y: 500 });
    expect(eyes.summoned).toEqual(["house", "tree", "cloud", "cloud"]);
    await player.wait(ARRIVAL_MS);
    const inks = player.renderer.lastFrame?.inks ?? [];
    expect(inks.map((ink) => ink.nature)).toEqual(["heavy", "climbable", "floaty", "floaty"]);
    const boxes = inks.map((ink) => boundsOf(ink.drawing.strokes.flat()));
    const lefts = boxes.map((box) => box.x);
    expect([...lefts].sort((a, b) => a - b)).toEqual(lefts);
    for (const box of boxes) expect(box.y + box.height).toBeLessThan(500);
    expect(player.written).toEqual(expect.arrayContaining(["a house", "a tree", "a cloud"]));
    expect((await player.store.load("wonderland")).drawings).toHaveLength(4);
  });

  it("names a drawing beside a bare word rather than summoning another", async () => {
    const eyes = drawer();
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.draw(blob({ x: 450, y: 520 }, 30, 30));
    await player.write("a rabbit", { x: 420, y: 480 });
    expect(eyes.summoned).toEqual([]);
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual(["hopper"]);

    await player.write("summon a rabbit", { x: 420, y: 400 });
    expect(eyes.summoned).toEqual(["rabbit"]);
    expect(player.renderer.lastFrame?.inks).toHaveLength(2);
  });

  it("asks the player to draw what it has never seen, and laws still come first", async () => {
    const eyes = drawer();
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.write("draw me a unicorn", { x: 300, y: 500 });
    expect(eyes.summoned).toEqual([]);
    expect(player.sim.snapshot().drawings).toHaveLength(0);
    expect(player.written).toContain(CANNOT_DRAW_LINE("a unicorn"));
    expect(player.pondered).toEqual([]);

    await player.write("no gravity", { x: 300, y: 400 });
    expect(eyes.summoned).toEqual([]);
    expect((await player.store.load("wonderland")).rules.map((r) => r.sourceText)).toEqual([
      "no gravity",
    ]);
  });

  it("still summons the Sumikui as a law, never as a picture", async () => {
    const eyes = drawer();
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.write("summon the ink eater", { x: 300, y: 500 });
    expect(eyes.summoned).toEqual([]);
    expect(player.written).toContain(SUMIKUI_SUMMONED_LINES[0]);
  });
});

describe("Game with a Kami who takes everyone places", () => {
  const STAR: Exemplar = {
    word: "star",
    strokes: [
      [
        { x: 0, y: 100 },
        { x: 50, y: 0 },
        { x: 100, y: 100 },
      ],
    ],
  };
  const traveller = () => {
    const eyes = new Eyes([], []);
    eyes.pictures.set("star", STAR);
    eyes.pictures.set("moon", { ...STAR, word: "moon" });
    return eyes;
  };

  it("goes to a place the atlas knows without a moment's thought", async () => {
    const player = new Player("wonderland", { eyes: traveller() });
    await player.arrive();
    await player.write("teleport us to the moon", { x: 300, y: 500 });
    expect(player.travelled).toEqual([]);
    expect(player.everWritten).not.toContain(PONDERING_LINE);
  });

  it("says he is thinking while the model invents a place the atlas does not know", async () => {
    const player = new Player("wonderland", { eyes: traveller() });
    await player.arrive();
    await player.write("teleport us to the land of lost socks", { x: 300, y: 500 });
    expect(player.travelled).toEqual(["teleport us to the land of lost socks"]);
    expect(player.everWritten).toContain(PONDERING_LINE);
    expect(player.written).not.toContain(PONDERING_LINE);
  });

  it("makes the Moon: its laws at once, its props drawn in one after another, all under one note", async () => {
    const eyes = traveller();
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.write("teleport us to the moon", { x: 300, y: 500 });
    expect(player.travelled).toEqual([]);
    expect(player.pondered).toEqual([]);

    const rules = (await player.store.load("wonderland")).rules;
    expect(rules.map((rule) => rule.effect.governs)).toEqual(["gravity", "airDrag", "daylight"]);
    expect(player.sim.snapshot().alice).toBeDefined();
    expect(player.renderer.lastFrame?.daylight).toBe(0.3);
    expect(player.laws.laws.map((law) => law.text)).toEqual(["teleport us to the moon"]);
    expect(player.laws.laws[0]?.gloss).toMatch(/gravity/);
    expect(player.written.some((text) => text.startsWith("kami: the Moon:"))).toBe(true);
    expect(player.written).toContain("One small step. Mind the dust.");

    expect(eyes.summoned).toEqual(["moon", "star", "star", "star"]);
    await player.wait(ARRIVAL_MS * 3);
    const drawings = (await player.store.load("wonderland")).drawings;
    expect(drawings).toHaveLength(4);
    expect(player.sim.snapshot().drawings).toHaveLength(4);
    expect(drawings.every((stored) => stored.ruling !== null)).toBe(true);
    for (const { drawing } of drawings) {
      expect(
        boundsOf(drawing.strokes.flat()).y + boundsOf(drawing.strokes.flat()).height,
      ).toBeLessThan(500);
    }

    await player.erase({ x: 310, y: 515 });
    expect((await player.store.load("wonderland")).rules).toHaveLength(0);
    expect(player.laws.laws).toEqual([]);
    expect(player.renderer.lastFrame?.daylight).toBe(1);
    expect(player.sim.snapshot().drawings).toHaveLength(4);
  });

  it("keeps the scene's props scenery after a reload, so the Sumikui still spares them", async () => {
    const player = new Player("wonderland", { eyes: traveller() });
    await player.arrive();
    await player.write("teleport us to the moon", { x: 300, y: 500 });
    await player.wait(ARRIVAL_MS * 3);
    const { drawings } = await player.store.load("wonderland");
    expect(drawings.map(({ provenance }) => provenance)).toEqual(Array(4).fill("scenery"));

    const reloaded = new Player("wonderland", { store: player.store });
    const added = vi.spyOn(reloaded.sim, "addDrawing");
    await reloaded.arrive();
    expect(added.mock.calls.map(([, provenance]) => provenance)).toEqual(Array(4).fill("scenery"));
  });

  it("replaces a previous scene's laws when it takes us home", async () => {
    const player = new Player("wonderland", { eyes: traveller() });
    await player.arrive();

    await player.write("teleport us to the moon", { x: 300, y: 500 });
    expect(player.laws.laws.map((law) => law.text)).toEqual(["teleport us to the moon"]);

    await player.write("take us home", { x: 300, y: 500 });

    expect(
      (await player.store.load("wonderland")).rules.every(
        (rule) => rule.sourceText === "take us home",
      ),
    ).toBe(true);
    expect(player.laws.laws).toHaveLength(1);
    expect(player.laws.laws[0]?.text).toBe("take us home");
    expect(player.renderer.lastFrame?.daylight).toBe(1);
  });

  it("replaces a scene written before a reload, not only one written this session", async () => {
    const player = new Player("wonderland", { eyes: traveller() });
    await player.arrive();
    await player.write("teleport us to the moon", { x: 300, y: 500 });
    expect(
      (await player.store.load("wonderland")).rules.every(({ scene }) => scene === "the Moon"),
    ).toBe(true);

    const reloaded = new Player("wonderland", { store: player.store, eyes: traveller() });
    await reloaded.arrive();
    await reloaded.write("take us home", { x: 300, y: 600 });

    expect(reloaded.laws.laws.map((law) => law.text)).toEqual(["take us home"]);
    expect(
      (await reloaded.store.load("wonderland")).rules.every(
        (rule) => rule.sourceText === "take us home",
      ),
    ).toBe(true);
    expect(reloaded.renderer.lastFrame?.daylight).toBe(1);
  });

  it("asks the model for a place the atlas has never heard of, and refuses none it knows", async () => {
    const eyes = traveller();
    const chocolate: Scene = {
      place: "the chocolate factory",
      laws: [{ effect: { governs: "friction", value: 0.2 }, explanation: "floors of fudge" }],
      props: [{ word: "star", at: { x: 0, y: -200 }, size: 1 }],
      line: "Mind the river.",
    };
    const player = new Player("wonderland", {
      eyes,
      farPlaces: { "take us to the chocolate factory": chocolate },
    });
    await player.arrive();

    await player.write("take us to the chocolate factory", { x: 300, y: 500 });
    expect(player.travelled).toEqual(["take us to the chocolate factory"]);
    expect(player.pondered).toEqual([]);
    expect(player.written).toContain("Mind the river.");
    expect(player.laws.laws.map((law) => law.gloss)).toEqual(["floors of fudge"]);
    expect(eyes.summoned).toEqual(["star"]);
  });

  it("says he does not know the way when nobody can make the place, after asking the thinker", async () => {
    const player = new Player("wonderland", { eyes: traveller() });
    await player.arrive();

    await player.write("take us to narnia", { x: 300, y: 500 });
    expect(await player.until(() => player.written.includes(NOWHERE_LINE("narnia")))).toBe(true);
    expect(player.travelled).toEqual(["take us to narnia"]);
    expect(player.pondered).toEqual(["take us to narnia"]);
    expect((await player.store.load("wonderland")).rules).toHaveLength(0);
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

describe("Game under a mode", () => {
  it("suspends forbidden saved laws without deleting them, and erasing their note still repeals them", async () => {
    const original = new Player("wonderland");
    await original.arrive();
    await original.write("it is night", { x: 200, y: 200 });
    await original.write("no gravity", { x: 200, y: 300 });
    const saved = await original.store.load("wonderland");
    const mode: GameMode = { ...EMBODIED_MODE, laws: { kind: "except", dials: ["daylight"] } };
    const restricted = new Player("wonderland", { store: original.store, mode });
    await restricted.arrive();

    expect(restricted.renderer.lastFrame?.daylight).toBe(1);
    expect(restricted.laws.laws.map((law) => law.text)).toEqual(["no gravity"]);
    expect(restricted.written).toContain(LAW_OUTSIDE_MODE_LINE);
    const note = restricted.renderer.lastFrame?.notes.find(
      (entry) => entry.script.text === "it is night",
    );
    expect(note?.tone).toBe("plain");
    expect(await original.store.load("wonderland")).toEqual(saved);

    const unrestricted = new Player("wonderland", { store: original.store });
    await unrestricted.arrive();
    expect(unrestricted.renderer.lastFrame?.daylight).toBe(original.renderer.lastFrame?.daylight);
    expect(unrestricted.renderer.lastFrame?.daylight).toBeLessThan(1);
    expect(unrestricted.laws.laws).toHaveLength(2);

    if (note === undefined) throw new Error("night note missing");
    const { x, y } = note.script.bounds;
    await restricted.erase({ x: x + 1, y: y + 1 });
    expect((await original.store.load("wonderland")).rules.map((rule) => rule.sourceText)).toEqual([
      "no gravity",
    ]);
    const reopened = new Player("wonderland", { store: original.store });
    await reopened.arrive();
    expect(reopened.renderer.lastFrame?.daylight).toBe(1);
  });

  it("also refuses forbidden model-compiled laws", async () => {
    const text = "make this page Martian";
    const mode: GameMode = { ...EMBODIED_MODE, laws: { kind: "only", dials: ["daylight"] } };
    const player = new Player("wonderland", {
      mode,
      thoughts: {
        [text]: {
          effect: { governs: "gravity", x: 0, y: 0.38 },
          explanation: "gravity = 0.38 g",
        },
      },
    });
    await player.arrive();
    await player.write(text, { x: 200, y: 200 });
    expect(player.pondered).toContain(text);
    expect(player.laws.laws).toHaveLength(0);
    expect((await player.store.load("wonderland")).rules).toHaveLength(0);
    expect(player.written).toContain(LAW_OUTSIDE_MODE_LINE);
  });

  it("refuses a law the mode forbids, in Kami's hand, and the note stays plain writing", async () => {
    const mode: GameMode = { ...EMBODIED_MODE, laws: { kind: "except", dials: ["gravity"] } };
    const player = new Player("wonderland", { mode });
    await player.arrive();
    await player.write("set g equal to the moon's gravity", { x: 200, y: 200 });
    expect((await player.store.load("wonderland")).rules).toHaveLength(0);
    expect(player.written).toContain(LAW_OUTSIDE_MODE_LINE);

    await player.write("it is night", { x: 200, y: 300 });
    expect((await player.store.load("wonderland")).rules).toHaveLength(1);
  });

  it("keeps Alice from walking herself when the mode forbids it", async () => {
    const player = new Player("wonderland", { mode: { ...EMBODIED_MODE, autopilot: "forbidden" } });
    await player.arrive();
    expect(player.hud.autopilotOffered).toBe(false);
    const parked = player.alice.center.x;
    player.game.onAutopilotToggled(true);
    expect(player.hud.autopilot).toBe(false);
    await player.wait(1_500);
    expect(player.alice.center.x).toBeCloseTo(parked, 0);
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
    await player.write("night", { x: 200, y: -200 });
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

describe("Game's CAT button", () => {
  const RUNGS = 3;

  const newLines = async (player: Player, ask: () => Promise<void>): Promise<string[]> => {
    const before = player.hud.announced.length;
    await ask();
    return player.hud.announced.slice(before);
  };

  const pressCat = (player: Player) => async (): Promise<void> => {
    player.hud.handlers.onAskForHint();
    await player.wait(100);
  };

  it("gives the hint writing *help* gives, one rung higher on each press", async () => {
    const writer = new Player("wonderland");
    const presser = new Player("wonderland");
    await writer.arrive();
    await presser.arrive();

    const written: string[][] = [];
    const pressed: string[][] = [];
    for (let rung = 0; rung < RUNGS; rung++) {
      written.push(await newLines(writer, () => writer.write("help", { x: 200, y: 200 })));
      pressed.push(await newLines(presser, pressCat(presser)));
    }

    expect(pressed).toEqual(written);
    expect(pressed.every((lines) => lines.length === 1)).toBe(true);
    expect(new Set(pressed.flat()).size).toBe(RUNGS);
    expect(presser.written).toEqual(expect.arrayContaining(pressed.flat()));
  });

  it("climbs the same ladder as writing *help*", async () => {
    const both = new Player("wonderland");
    const writer = new Player("wonderland");
    await both.arrive();
    await writer.arrive();

    const mixed = [
      ...(await newLines(both, pressCat(both))),
      ...(await newLines(both, () => both.write("help", { x: 200, y: 200 }))),
    ];
    const plain = [
      ...(await newLines(writer, () => writer.write("help", { x: 200, y: 200 }))),
      ...(await newLines(writer, () => writer.write("help", { x: 200, y: 200 }))),
    ];

    expect(mixed).toEqual(plain);
  });

  it("writes the hint above Alice, clear of the toolbar", async () => {
    const player = new Player("wonderland");
    await player.arrive();
    const [hint] = await newLines(player, pressCat(player));
    const note = player.renderer.lastFrame?.notes.find((view) => view.script.text === hint);
    const alice = player.alice;

    expect(note).toBeDefined();
    expect(note?.script.bounds.y).toBeLessThan(alice.center.y);
    expect(note?.script.bounds.y).toBeGreaterThanOrEqual(player.hud.toolbarBottomY);
  });

  it("says nothing while the board is loading", async () => {
    const store = new MemoryBoardStore();
    const pending = Promise.withResolvers<BoardSnapshot>();
    vi.spyOn(store, "load").mockReturnValueOnce(pending.promise);
    const player = new Player("wonderland", { store });
    const arrival = player.arrive();
    await player.wait(50);

    const lines = await newLines(player, pressCat(player));

    expect(lines).toEqual([]);
    pending.resolve({ drawings: [], notes: [], rules: [] });
    await arrival;
  });
});

describe("Game's undo", () => {
  it("takes back the player's own law, then drawing, and refunds the ink", async () => {
    const player = new Player("wonderland");
    await player.arrive();
    const refund = vi.spyOn(player.ink, "refund");
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.write("it is night", { x: 200, y: 200 });
    const [drawn] = (await player.store.load("wonderland")).drawings;
    expect(player.laws.laws).toHaveLength(1);
    expect(player.renderer.lastFrame?.daylight).toBeLessThan(1);

    player.game.onUndo();
    await player.wait(50);
    expect(player.laws.laws).toHaveLength(0);
    expect(player.renderer.lastFrame?.daylight).toBe(1);
    expect(player.written).not.toContain("it is night");
    expect((await player.store.load("wonderland")).rules).toHaveLength(0);
    expect(player.renderer.lastFrame?.inks).toHaveLength(1);

    player.game.undo();
    await player.wait(50);
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    expect((await player.store.load("wonderland")).drawings).toHaveLength(0);
    expect(refund).toHaveBeenCalledWith(drawn?.drawing.cost);
    expect(drawn?.drawing.cost).toBeGreaterThan(0);

    player.game.undo();
    await player.wait(50);
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
  });

  it("takes back ink still under the pen before anything already on the page", async () => {
    const player = new Player("wonderland");
    await player.arrive();
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    const landed = (await player.store.load("wonderland")).drawings.map(
      ({ drawing }) => drawing.id,
    );
    player.game.penDown({ x: 500, y: 400 });
    player.game.penMove({ x: 600, y: 400 });
    player.game.penUp();
    player.game.undo();
    await player.wait(COMMIT_WAIT_MS);
    const kept = (await player.store.load("wonderland")).drawings.map(({ drawing }) => drawing.id);
    expect(kept).toEqual(landed);
    expect(landed).toHaveLength(1);
  });

  it("skips what was already erased and forgets everything when another board opens", async () => {
    const player = new Player("wonderland");
    await player.arrive();
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.write("it is night", { x: 200, y: 200 });
    await player.erase({ x: 210, y: 215 });
    player.game.undo();
    await player.wait(50);
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);

    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    player.game.onOpenBoard("elsewhere");
    await player.wait(50);
    player.game.onOpenBoard("wonderland");
    await player.wait(50);
    player.game.undo();
    await player.wait(50);
    expect(player.renderer.lastFrame?.inks).toHaveLength(1);
  });

  it("is ignored while the board loads", async () => {
    const store = new MemoryBoardStore();
    const pending = Promise.withResolvers<BoardSnapshot>();
    vi.spyOn(store, "load").mockReturnValueOnce(pending.promise);
    const player = new Player("wonderland", { store });
    const arrival = player.arrive();
    const retract = vi.spyOn(player.ink, "retract");
    player.game.undo();
    expect(retract).not.toHaveBeenCalled();
    pending.resolve({ drawings: [], notes: [], rules: [] });
    await arrival;
  });
});

describe("Game's voice for screen readers", () => {
  it("reads out what Kami says, but not his wordmark or a board loading", async () => {
    const player = new Player("wonderland");
    await player.arrive();
    await player.write("it is night", { x: 200, y: 200 });
    const { announced } = player.hud;
    expect(announced).not.toContain(WORDMARK);
    expect(announced).not.toContain(TAGLINE);
    expect(announced).not.toContain("Loading board…");
    expect(announced.some((line) => line.startsWith("kami:"))).toBe(true);
    await player.erase({ x: 210, y: 215 });
    expect(announced).toContain(RULE_REPEALED_LINE);
  });
});

describe("Game under reduced motion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const anglesWhileSpinning = async (): Promise<readonly number[]> => {
    const player = new Player("wonderland");
    await player.arrive();
    await player.write("the world spins slowly", { x: 200, y: 200 });
    const angles: number[] = [];
    for (let frame = 0; frame < 240; frame++) {
      await player.wait(FIXED_STEP_MS);
      angles.push(player.renderer.lastFrame?.camera.angle ?? 0);
    }
    return angles;
  };

  const turnsBetweenFrames = (angles: readonly number[]): readonly number[] =>
    angles.flatMap((angle, frame) => {
      const before = angles[frame - 1];
      return before === undefined || before === angle ? [] : [Math.abs(angle - before)];
    });

  it("turns the camera with the spinning page every frame", async () => {
    const turns = turnsBetweenFrames(await anglesWhileSpinning());
    expect(turns.length).toBeGreaterThan(100);
    expect(Math.max(...turns)).toBeLessThan(1);
  });

  it("turns the camera in steps of 15° or more when the player asks for less motion", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    const turns = turnsBetweenFrames(await anglesWhileSpinning());
    expect(turns.length).toBeGreaterThan(0);
    for (const turn of turns) expect(turn).toBeGreaterThanOrEqual(15);
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

  it("gives the controls back to Alice herself when the law that made the chosen twin is erased", async () => {
    const player = new Player("my-first-game");
    await player.arrive();
    await player.write("clone alice", { x: -200, y: -200 });
    const twin = () => player.renderer.lastFrame?.world.twins[0];
    expect(await player.until(() => twin() !== undefined)).toBe(true);
    const tapped = twin();
    if (tapped === undefined) throw new Error("no twin to tap");
    player.use("draw");
    player.game.tap(tapped.center);
    await player.wait(100);
    expect(player.renderer.lastFrame?.selectedAlice).toBe(1);

    await player.erase({ x: -190, y: -185 });
    await player.wait(100);
    expect(player.renderer.lastFrame?.world.twins).toEqual([]);
    expect(player.renderer.lastFrame?.selectedAlice).toBe(0);
    expect(player.written).toContain(RULE_REPEALED_LINE);
  });

  it("hands the controls to a tapped twin, and says which Alice found the rabbit hole", async () => {
    const player = new Player("my-first-game");
    await player.arrive();
    await player.write("clone alice", { x: -200, y: -200 });
    const twin = () => player.renderer.lastFrame?.world.twins[0];
    expect(await player.until(() => twin() !== undefined)).toBe(true);
    const tapped = twin();
    if (tapped === undefined) throw new Error("no twin to tap");
    expect(player.renderer.lastFrame?.selectedAlice).toBe(0);

    player.use("draw");
    player.game.tap(tapped.center);
    await player.wait(100);
    expect(player.renderer.lastFrame?.selectedAlice).toBe(1);
    expect(player.written).toContain("Alice 2, then. Lead on.");

    player.game.onAutopilotToggled(false);
    await player.draw(blob({ x: 250, y: -20 }, 16, 16));
    await player.write("goal", { x: 240, y: -110 });
    const herself = player.alice.center.x;
    player.walk(1);
    const found = () => player.written.filter((text) => text.includes("found the rabbit hole"));
    expect(await player.until(() => found().length > 0)).toBe(true);
    expect(found()).toEqual(["Alice 2 found the rabbit hole. One of you was enough."]);
    expect(player.alice.center.x).toBeCloseTo(herself, 0);
    expect(player.renderer.lastFrame?.selectedAlice).toBe(1);
  });
});

describe("Game in puzzle mode", () => {
  const spring = blob({ x: 680, y: 545 }, 35, 15);

  it("opens the first room with its card, the Sumikui loose without a note, and the room's laws only", async () => {
    const player = new Player(FIRST_PUZZLE_BOARD_ID, { mode: PUZZLE_MODE });
    await player.arrive();
    expect(player.hud.roomCard).toMatchObject({
      mode: "Puzzle",
      title: "The Wall",
      mark: `room 1 of ${PUZZLE_ROOMS.length}`,
    });
    expect(player.hud.cards).toEqual([]);
    expect(player.written).not.toContain(PUZZLE_MODE.card.opening);
    expect(player.written).not.toContain(cardLineOf(PUZZLE_MODE));
    expect(player.renderer.lastFrame?.world.sumikui).not.toBeNull();
    expect(player.laws.laws).toHaveLength(0);
    const opening = "Too tall to climb. She could fall up, if something threw her.";
    expect(player.written.filter((text) => text === opening)).toHaveLength(0);
    await player.wait(roomCardShownMs() - 100);
    expect(player.written.filter((text) => text === opening)).toHaveLength(0);
    await player.wait(roomCardShownMs() + 600);
    expect(player.written.filter((text) => text === opening)).toHaveLength(1);

    await player.write("we are on the moon", { x: 200, y: 200 });
    expect(player.written).toContain(LAW_OUTSIDE_MODE_LINE);
    expect(player.laws.laws).toHaveLength(0);

    await player.write("banish the ink eater", { x: 200, y: 300 });
    expect(player.laws.laws.map((law) => law.text)).toEqual(["banish the ink eater"]);
    expect(player.written).toContain(SUMIKUI_SEALED_LINE);
    expect(player.renderer.lastFrame?.world.sumikui).toBeNull();
  });

  it("names ink only as the room allows, and opens the next room after the closing line", async () => {
    const player = new Player(FIRST_PUZZLE_BOARD_ID, { mode: PUZZLE_MODE });
    await player.arrive();
    await player.draw(spring);
    await player.write("a ladder", { x: 640, y: 440 });
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual(["ink"]);
    await player.write("a trampoline", { x: 640, y: 400 });
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual(["bouncy"]);

    player.game.onAutopilotToggled(true);
    const [firstRoom, secondRoom] = PUZZLE_ROOMS;
    if (firstRoom === undefined || secondRoom === undefined) throw new Error("no rooms");
    expect(await player.until(() => player.written.includes(firstRoom.closing))).toBe(true);
    expect(await player.until(() => player.hud.roomCard?.title === "The Keyhole", 6_000)).toBe(
      true,
    );
    expect(player.hud.roomCard?.mark).toBe(`room 2 of ${PUZZLE_ROOMS.length}`);
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    expect(player.renderer.lastFrame?.world.sumikui).not.toBeNull();
  });

  it("offers the run's restart instead of the board menu, and it opens the first room", async () => {
    const [, secondRoom] = PUZZLE_ROOMS;
    if (secondRoom === undefined) throw new Error("no second room");
    const player = new Player(secondRoom.boardId, { mode: PUZZLE_MODE });
    await player.arrive();
    expect(player.hud.menu).toBe("run");
    expect(player.hud.roomCard?.mark).toBe(`room 2 of ${PUZZLE_ROOMS.length}`);

    player.game.onRestartRun();
    expect(await player.until(() => player.hud.roomCard?.title === "The Wall")).toBe(true);
    expect(player.hud.roomCard?.mark).toBe(`room 1 of ${PUZZLE_ROOMS.length}`);
  });

  it("keeps the board menu, and ignores a run restart, outside a staged run", async () => {
    const player = new Player("wonderland");
    await player.arrive();
    expect(player.hud.menu).toBe("boards");
    player.game.onRestartRun();
    await player.wait(200);
    expect(player.hud.roomCard).toBeNull();
  });

  it("stages the ledge on Earth until the moon is written", async () => {
    const ledge = new Player("puzzle-moon-ledge", { mode: PUZZLE_MODE });
    await ledge.arrive();
    await ledge.write("we are on the moon", { x: 200, y: 200 });
    expect(ledge.laws.laws.map((law) => law.text)).toEqual(["we are on the moon"]);
    expect(ledge.renderer.lastFrame?.world.sumikui).not.toBeNull();
  });

  it("shows a Solved card after the last room", async () => {
    const player = new Player("puzzle-moon-ledge", { mode: PUZZLE_MODE });
    await player.arrive();
    (
      player.game as unknown as {
        celebrate: (event: { type: "goal-reached"; who: number }) => void;
      }
    ).celebrate({
      type: "goal-reached",
      who: 0,
    });
    expect(player.hud.cards.at(-1)).toMatchObject({
      title: "Solved",
      tagline: "Three rooms, all of them yours. Draw on, or play again.",
    });
  });

  it("shows a Lost card when the ink eater restarts the room", async () => {
    const player = new Player(FIRST_PUZZLE_BOARD_ID, { mode: PUZZLE_MODE });
    await player.arrive();
    (player.game as unknown as { lose: (cause: "devoured") => void }).lose("devoured");
    await player.wait(3_000);
    expect(player.hud.cards.at(-1)).toMatchObject({
      title: "Lost",
      tagline: "The ink eater got her. Again, this room.",
    });
    expect(player.hud.roomCard?.title).toBe("The Wall");
  });
});

describe("Game in the Sandbox", () => {
  const sandbox = (known: readonly string[] = ["bridge", "ladder", "rabbit", "cat"]) => {
    const eyes = new Eyes([], [], known);
    return { eyes, player: new Player("together", { mode: SANDBOX_MODE, eyes }) };
  };

  it("opens on an endless page with the mode's own opening line, and no rabbit hole to reach", async () => {
    const { player } = sandbox();
    await player.arrive();
    expect(player.written).not.toContain(SANDBOX_MODE.card.opening);
    expect(player.written).not.toContain(cardLineOf(SANDBOX_MODE));
    expect(player.renderer.board?.page).toBe("endless");
    expect(player.renderer.board?.goal).toBeUndefined();
  });

  it("quietly drops ink beneath the endless page ground", async () => {
    const { player } = sandbox();
    await player.arrive();
    await player.draw(line({ x: 100, y: 100 }, { x: 220, y: 100 }));
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);

    await player.draw(line({ x: 100, y: -40 }, { x: 220, y: -40 }));
    expect(player.renderer.lastFrame?.inks).toHaveLength(1);
  });

  it("keeps Kami's reply to a name clear of the ground and Alice", async () => {
    const { player } = sandbox(["dog"]);
    await player.arrive();
    const centre = player.alice.center;
    await player.draw(ringAround({ x: centre.x - 70, y: centre.y }, 25));
    await player.write("a dog", { x: centre.x - 30, y: centre.y });
    await player.wait(500);

    const notebook = (player.game as unknown as { notes: NoteBook }).notes;
    const notes = (player.renderer.lastFrame?.notes ?? []).filter((note) =>
      notebook.fleetingBy("kami").some(({ id }) => id === note.id),
    );
    const alice = player.sim.aliceBounds(0);
    const viewport = player.renderer.viewport();
    const visible = { x: 0, y: 0, width: viewport.width, height: viewport.height };
    for (const note of notes) {
      expect(rectsOverlap(note.script.bounds, ENDLESS_GROUND)).toBe(false);
      expect(rectsOverlap(note.script.bounds, alice)).toBe(false);
      expect(note.script.bounds.x).toBeGreaterThanOrEqual(visible.x);
      expect(note.script.bounds.y).toBeGreaterThanOrEqual(visible.y);
      expect(note.script.bounds.x + note.script.bounds.width).toBeLessThanOrEqual(
        visible.x + visible.width,
      );
      expect(note.script.bounds.y + note.script.bounds.height).toBeLessThanOrEqual(
        visible.y + visible.height,
      );
    }
  });

  it("says when Alice falls off the endless page", async () => {
    const { player } = sandbox();
    await player.arrive();
    player.game.onAutopilotToggled(false);
    player.walk(1);
    expect(await player.until(() => player.written.includes(FELL_OFF_PAGE_LINE), 10_000)).toBe(
      true,
    );
  });

  it("tells the player the page ends where the ground does, when asked for help at the edge", async () => {
    const { player, eyes } = sandbox();
    await player.arrive();
    await player.write("help", { x: 60, y: -160 });
    expect(player.written).toContain(DROP_LINE);
    expect(eyes.summoned).toEqual([]);
  });

  it("answers the CAT button with the same counsel as writing *help*", async () => {
    const { player, eyes } = sandbox();
    await player.arrive();
    player.hud.handlers.onAskForHint();
    await player.wait(100);
    expect(player.written).toContain(DROP_LINE);
    expect(eyes.summoned).toEqual([]);
  });

  it("does not repeat the same counsel while the first line is still visible", async () => {
    const { player } = sandbox();
    await player.arrive();
    await player.write("help", { x: 60, y: -160 });
    await player.write("give me an idea", { x: 60, y: -160 });

    expect(player.written.filter((text) => text === DROP_LINE)).toHaveLength(1);
  });

  it("starts a bridge across a gap when asked how to get across", async () => {
    const { player, eyes } = sandbox();
    await player.arrive();
    await player.draw(line({ x: 620, y: 0 }, { x: 900, y: 0 }));
    await player.write("ground", { x: 760, y: -120 });
    await player.write("how do I get across?", { x: 60, y: -160 });
    expect(player.written).toContain(BRIDGE_LINE);
    expect(eyes.summoned).toEqual(["bridge"]);
    await player.wait(2_000);
    const bridge = player.renderer.lastFrame?.inks.at(-1);
    expect(bridge).toBeDefined();
    const span =
      bridge === undefined
        ? null
        : boundsOf(bridge.drawing.strokes.flat().map((point) => poseToWorld(point, bridge.pose)));
    expect(span?.x).toBeLessThan(ENDLESS_GROUND.x + ENDLESS_GROUND.width);
    expect((span?.x ?? 0) + (span?.width ?? 0)).toBeGreaterThan(620);
  });

  it("leans a ladder against a wall too tall to jump", async () => {
    const { player, eyes } = sandbox();
    await player.arrive();
    await player.scrawl([
      line({ x: 200, y: 0 }, { x: 200, y: -320 }),
      line({ x: 200, y: -320 }, { x: 260, y: -320 }),
      line({ x: 260, y: -320 }, { x: 260, y: 0 }),
    ]);
    await player.write("wall", { x: 300, y: -400 });
    await player.write("what can I do?", { x: 60, y: -160 });
    expect(player.written).toContain(LADDER_LINE);
    expect(eyes.summoned).toEqual(["ladder"]);
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toContain("climbable");
  });

  it("sketches a friend beside her on an open stretch, when asked for an idea", async () => {
    const { player, eyes } = sandbox();
    await player.arrive();
    await player.draw(line({ x: -1500, y: 20 }, { x: 1500, y: 20 }));
    await player.write("ground", { x: 1000, y: -120 });
    await player.write("give me an idea", { x: 60, y: -160 });
    expect(player.written).toContain(IDEAS[0]?.line);
    expect(eyes.summoned).toEqual(["rabbit"]);
    await player.wait(2_000);
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual(["solid", "hopper"]);
  });

  it("offers ideas in turn when there is nothing to draw them with", async () => {
    const { player, eyes } = sandbox([]);
    await player.arrive();
    await player.draw(line({ x: -1500, y: 20 }, { x: 1500, y: 20 }));
    await player.write("ground", { x: 1000, y: -120 });
    await player.write("give me an idea", { x: 60, y: -160 });
    expect(player.written).toContain(IDEAS[0]?.line);
    await player.write("any ideas?", { x: 60, y: -260 });
    expect(player.written).toContain(IDEAS[1]?.line);
    expect(eyes.summoned).toEqual(["rabbit"]);
  });

  it("leaves words alone without the server's pictures", async () => {
    const { player, eyes } = sandbox([]);
    await player.arrive();
    await player.draw(line({ x: 620, y: 0 }, { x: 900, y: 0 }));
    await player.write("ground", { x: 760, y: -120 });
    const before = player.renderer.lastFrame?.inks.length ?? 0;
    await player.write("help", { x: 60, y: -160 });
    expect(player.written).toContain(BRIDGE_LINE);
    expect(eyes.summoned).toEqual(["bridge"]);
    expect(player.renderer.lastFrame?.inks).toHaveLength(before);
  });

  it("never offers help unasked, however long she idles, while a room still does", async () => {
    const { player } = sandbox();
    await player.arrive();
    await player.wait(50_000);
    expect(player.written.some((text) => text.includes(OFFER_HELP))).toBe(false);

    const roomed = new Player("wonderland");
    await roomed.arrive();
    await roomed.wait(50_000);
    expect(roomed.written.some((text) => text.includes(OFFER_HELP))).toBe(true);
  });

  it("has nothing hungry on the page: the ink eater is refused in lore", async () => {
    const { player } = sandbox();
    await player.arrive();
    await player.write("summon the ink eater", { x: 200, y: -200 });
    expect(player.written).toContain(NOTHING_HUNGRY_LINE);
    expect(player.written).not.toContain(SUMIKUI_SUMMONED_LINES[0]);
    expect(player.renderer.lastFrame?.world.sumikui ?? null).toBeNull();
    expect(player.laws.laws).toHaveLength(0);
  });

  it("puts her back on the last ink she stood on when she walks off it", async () => {
    const { player } = sandbox();
    await player.arrive();
    player.walk(1);
    expect(await player.until(() => player.written.includes(FELL_OFF_PAGE_LINE), 20_000)).toBe(
      true,
    );
    player.walk(0);
    expect(player.alice.center.y).toBeLessThan(0);
    expect(player.alice.center.x).toBeLessThan(ENDLESS_GROUND.x + ENDLESS_GROUND.width);
    expect(player.alice.center.x).toBeGreaterThan(0);
  });
});

describe("Game on a shared page", () => {
  const ALICE = "peer-alice" as PeerId;
  const BOB = "peer-bob" as PeerId;
  const shareLinkFor = (boardId: string) => `http://kami.test/?board=${boardId}&mode=sandbox`;

  const together = async () => {
    const page = new SharedPage();
    const mine = new Player("together", {
      mode: SANDBOX_MODE,
      store: page,
      link: page.link(ALICE, 0),
      shareLinkFor,
    });
    const theirs = new Player("together", {
      mode: SANDBOX_MODE,
      store: page,
      link: page.link(BOB, 0),
      shareLinkFor,
    });
    await mine.arrive();
    await theirs.arrive();
    return { page, mine, theirs };
  };

  it("shows what another device draws, names, writes and erases, the moment it happens", async () => {
    const { mine, theirs } = await together();
    await mine.draw(line({ x: 620, y: 0 }, { x: 900, y: 0 }));
    await theirs.wait(50);
    expect(theirs.renderer.lastFrame?.inks).toHaveLength(1);
    expect(theirs.renderer.lastFrame?.inks).toHaveLength(mine.renderer.lastFrame?.inks.length ?? 0);
    await mine.write("ground", { x: 760, y: -120 });
    await theirs.wait(50);
    expect(theirs.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual(["solid"]);
    expect(theirs.written).toContain("ground");
    await mine.erase({ x: 760, y: 0 });
    await theirs.wait(50);
    expect(theirs.renderer.lastFrame?.inks).toHaveLength(0);
    expect(theirs.written).not.toContain("ground");
  });

  it("never undoes what another device made", async () => {
    const { mine, theirs } = await together();
    await theirs.draw(line({ x: 620, y: 0 }, { x: 900, y: 0 }));
    await theirs.write("it is night", { x: 200, y: -200 });
    await mine.wait(50);
    mine.game.undo();
    mine.game.undo();
    await mine.wait(50);
    await theirs.wait(50);
    expect(mine.renderer.lastFrame?.inks).toHaveLength(1);
    expect(mine.laws.laws).toHaveLength(1);
    expect(theirs.renderer.lastFrame?.inks).toHaveLength(1);
  });

  it("folds another device's laws into its own world, and refolds when they are erased", async () => {
    const { mine, theirs } = await together();
    const day = theirs.renderer.lastFrame?.daylight;
    await mine.write("it is night", { x: 200, y: -200 });
    await theirs.wait(50);
    expect(theirs.laws.laws.map((law) => law.text)).toEqual(["it is night"]);
    expect(theirs.renderer.lastFrame?.daylight).toBeLessThan(day ?? 1);
    expect(theirs.written.some((text) => text.startsWith("kami:"))).toBe(true);
    expect(mine.laws.laws).toHaveLength(1);

    await mine.erase({ x: 210, y: -185 });
    await theirs.wait(50);
    expect(theirs.laws.laws).toHaveLength(0);
    expect(theirs.renderer.lastFrame?.daylight).toBe(day);
    expect(theirs.written).not.toContain("it is night");
  });

  it("hears its own changes echoed back without doubling them", async () => {
    const { mine } = await together();
    await mine.draw(line({ x: 620, y: 0 }, { x: 900, y: 0 }));
    await mine.write("ground", { x: 760, y: -120 });
    await mine.write("it is night", { x: 200, y: -200 });
    expect(mine.renderer.lastFrame?.inks).toHaveLength(1);
    expect(mine.laws.laws).toHaveLength(1);
    expect(mine.written.filter((text) => text === "ground")).toHaveLength(1);
    expect(mine.written.filter((text) => text.startsWith("kami:"))).toHaveLength(1);
  });

  it("shows the other device's Alice as a ghost, and counts her in the share affordance", async () => {
    const { mine, theirs } = await together();
    await mine.wait(500);
    await theirs.wait(50);
    const ghosts = theirs.renderer.lastFrame?.ghosts ?? [];
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]?.center).toEqual(mine.alice.center);
    expect(theirs.hud.share).toEqual({
      boardId: "together",
      link: "http://kami.test/?board=together&mode=sandbox",
      company: 1,
    });
    expect(theirs.hud.cards).toEqual([SANDBOX_MODE.card]);
  });

  it("lets a ghost go when its device leaves the page", async () => {
    const { page, mine, theirs } = await together();
    await mine.wait(500);
    expect(theirs.game.company).toHaveLength(1);
    page.drop(ALICE);
    await theirs.wait(50);
    expect(theirs.game.company).toHaveLength(0);
    expect(theirs.hud.share?.company).toBe(0);
  });

  it("wipes its own page when another device clears the board", async () => {
    const { mine, theirs } = await together();
    await mine.draw(line({ x: 620, y: 0 }, { x: 900, y: 0 }));
    await theirs.wait(50);
    expect(theirs.renderer.lastFrame?.inks).toHaveLength(1);
    mine.game.onClearBoard();
    await theirs.wait(200);
    expect(theirs.renderer.lastFrame?.inks).toHaveLength(0);
  });

  it("plays alone, with no share affordance, in a room", async () => {
    const page = new SharedPage();
    const roomed = new Player("wonderland", { store: page, link: page.link(BOB), shareLinkFor });
    await roomed.arrive();
    await roomed.wait(500);
    expect(page.peersOn("wonderland")).toEqual([]);
    expect(page.presences).toEqual([]);
    expect(roomed.hud.share).toBeNull();
    expect(roomed.hud.cards).toEqual([]);
  });
});

describe("Game in Boss mode", () => {
  const soulOf = (player: Player): Vec => {
    const soul = player.renderer.lastFrame?.world.soul;
    if (soul === undefined) throw new Error("Nothing has been rendered yet");
    if (soul === null) throw new Error("Somebody is on the board");
    return soul.at;
  };

  const drawnLook = (player: Player) => {
    const { look } = player.alice;
    if (look.kind !== "drawn") throw new Error("She wears Kami's own sketch");
    return look;
  };

  const tearOf = (player: Player) => player.renderer.lastFrame?.world.tear ?? null;

  let player: Player;

  beforeEach(async () => {
    player = new Player("wonderland", { mode: BOSS_MODE });
    await player.arrive();
  });

  it("opens as a soul, tells both players their part, and will not walk her by herself", async () => {
    expect(player.renderer.lastFrame?.world.alice).toBeNull();
    expect(soulOf(player).x).toBeCloseTo(
      BOSS_MODE.page === "arena" ? 0 : boardFor("wonderland").spawn.x,
      0,
    );
    expect(player.written).not.toContain(SOUL_WAITS_LINE);
    expect(player.written).not.toContain(BOSS_MODE.card.opening);
    expect(player.written).not.toContain("She can hop, not fly. You can draw.");
    for (const role of BOSS_MODE.card.roles ?? []) expect(player.written).not.toContain(role);
    expect(player.hud.cards).toEqual([BOSS_MODE.card]);
    await player.wait(titleCardShownMs(BOSS_MODE.card) + 600);
    expect(player.written).toContain(SOUL_WAITS_LINE);
    player.game.onAutopilotToggled(true);
    expect(player.hud.autopilot).toBe(false);
    player.walk(1);
    await player.wait(500);
    expect(player.renderer.lastFrame?.world.alice).toBeNull();
  });

  it("keeps the soul when the arena is rebuilt on resize", async () => {
    expect(soulOf(player)).toBeDefined();
    player.game.onResize();
    expect(soulOf(player)).toBeDefined();
    expect(player.renderer.lastFrame?.world.alice).toBeNull();
  });

  it("clears player ink and laws while keeping the Boss soul", async () => {
    const heart = soulOf(player);
    player.game.onCommit(drawingOf("old ink", ringAround({ x: heart.x + 80, y: heart.y }, 20)));
    await player.write("gravity is weaker", { x: heart.x + 200, y: heart.y + 100 });
    expect(player.renderer.lastFrame?.inks).toHaveLength(1);
    expect(player.laws.laws).toHaveLength(1);

    player.game.onClearBoard();
    await player.wait(100);

    expect(soulOf(player)).toEqual(expect.objectContaining({ x: heart.x, y: heart.y }));
    expect(player.renderer.lastFrame?.world.tear).toBeNull();
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    expect(player.laws.laws).toHaveLength(0);
  });

  it("drops ink below the arena floor but accepts ink beside it", async () => {
    await player.draw(line({ x: 100, y: 40 }, { x: 180, y: 40 }));
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);

    await player.draw(line({ x: 100, y: -40 }, { x: 180, y: -40 }));
    expect(player.renderer.lastFrame?.inks).toHaveLength(1);

    await player.write("gravity is weaker", { x: 100, y: 40 });
    expect(player.laws.laws).toHaveLength(0);
    expect(player.written).not.toContain("gravity is weaker");
  });

  it("opens every Boss fight on a fresh page", async () => {
    const drawing = drawingOf("old-fight", ringAround(soulOf(player), 30));
    player.game.onCommit(drawing);
    await player.wait(100);
    expect((await player.store.load("wonderland")).drawings).toHaveLength(1);

    player.game.onOpenBoard("wonderland");
    await player.wait(100);

    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    expect((await player.store.load("wonderland")).drawings).toHaveLength(0);
  });

  it("makes the drawing her body when it is named, and tears the page open above her", async () => {
    const heart = soulOf(player);
    const body = drawingOf("body", ...figureAround(heart));
    player.game.onCommit(body);
    await player.wait(50);
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.drawing.id)).toEqual([body.id]);

    await player.write("me", { x: heart.x, y: heart.y + 45 });
    expect(player.renderer.lastFrame?.world.soul).toBeNull();
    expect(drawnLook(player).body.strokes).toHaveLength(6);
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    expect(player.written).toContain(INCARNATED_LINE("me"));
    expect(tearOf(player)?.phase).toBe("opening");
    expect((await player.store.load("wonderland")).drawings).toHaveLength(0);

    expect(await player.until(() => (tearOf(player)?.snippers.length ?? 0) > 0)).toBe(true);
    expect(player.written).toContain(TEAR_OPENS_LINES[0]);
    expect(player.written).toContain(SERVANT_CAME_LINE);
  });

  it("names a body from anywhere on the page when the player is still a soul", async () => {
    const heart = soulOf(player);
    player.game.onCommit(drawingOf("body", ringAround(heart, 30)));
    await player.wait(50);
    await player.write("alice", { x: heart.x + 200, y: heart.y + 100 });
    expect(player.renderer.lastFrame?.world.soul).toBeNull();
    expect(drawnLook(player).body.strokes).toHaveLength(1);
  });

  it("makes a body drawn as several drawings one body when named", async () => {
    const heart = soulOf(player);
    const far = drawingOf("far", ringAround({ x: heart.x + 300, y: heart.y }, 20));
    player.game.onCommit(far);
    await player.wait(50);
    for (const stroke of bossPaceBody(heart)) await player.draw(stroke);

    await player.write("alice", { x: heart.x + 200, y: heart.y + 100 });

    expect(player.sim.snapshot().alice?.look.kind).toBe("drawn");
    const look = drawnLook(player);
    expect(look.abilities.see).toBe(true);
    expect(look.abilities.walk).toBe(true);
    expect(look.abilities.climb).toBe(true);
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.drawing.id)).toEqual([far.id]);
  });

  it("keeps free combat remarks clear of the tear", async () => {
    const heart = soulOf(player);
    player.game.onCommit(drawingOf("body", ringAround(heart, 30)));
    await player.write("alice", { x: heart.x + 200, y: heart.y + 100 });
    const tear = tearOf(player);
    if (tear === null) throw new Error("the tear did not open");

    (
      player.game as unknown as {
        remark: (line: string) => void;
      }
    ).remark("clear of the tear");
    await player.wait(50);

    const note = player.renderer.lastFrame?.notes.find(
      ({ script }) => script.text === "clear of the tear",
    );
    if (note === undefined) throw new Error("the combat remark was not written");
    expect(
      rectsOverlap(note.script.bounds, {
        x: tear.at.x - 40,
        y: tear.at.y - 120,
        width: 80,
        height: 240,
      }),
    ).toBe(false);
  });

  it("offers Alice instead of scenery guesses for the body nearest the soul", async () => {
    const eyes = new Eyes([], [seen("mushroom", "ink"), seen("cake", "ink")]);
    const player = new Player("wonderland", { eyes, mode: BOSS_MODE });
    await player.arrive();
    const heart = soulOf(player);
    player.game.onCommit(drawingOf("body", ringAround(heart, 30)));
    await player.wait(100);

    const guesses = player.renderer.lastFrame?.notes.filter((note) => note.tappable) ?? [];
    expect(guesses.map((note) => note.script.text)).toEqual(["Alice?"]);
    expect(player.written).toContain(IS_THIS_HER_LINE);

    const first = guesses[0];
    if (first === undefined) throw new Error("no Alice guess to tap");
    const { x, y, width, height } = first.script.bounds;
    player.game.tap({ x: x + width / 2, y: y + height / 2 });
    await player.wait(100);

    expect(player.renderer.lastFrame?.world.soul).toBeNull();
    expect(drawnLook(player).body.strokes).toHaveLength(1);
  });

  it("keeps normal scenery guesses for drawings far from the soul", async () => {
    const eyes = new Eyes([], [seen("mushroom", "ink"), seen("cake", "ink")]);
    const player = new Player("wonderland", { eyes, mode: BOSS_MODE });
    await player.arrive();
    const soul = soulOf(player);
    player.game.onCommit(drawingOf("far", ringAround({ x: soul.x + 300, y: soul.y }, 20)));
    await player.wait(100);

    const guesses = player.renderer.lastFrame?.notes.filter((note) => note.tappable) ?? [];
    expect(guesses.map((note) => note.script.text)).toEqual([
      "a mushroom?",
      "a cake?",
      "a balloon?",
    ]);
  });

  it("never sends her body to be tidied: not when named, nor when the slider comes to rest", async () => {
    const eyes = new Eyes([], []);
    const twoPlayers = new Player("wonderland", { eyes, mode: BOSS_MODE });
    await twoPlayers.arrive();
    const heart = soulOf(twoPlayers);
    twoPlayers.game.onCommit(drawingOf("body", ...figureAround(heart)));
    await twoPlayers.write("me", { x: heart.x, y: heart.y + 45 });
    expect(drawnLook(twoPlayers).body.strokes).toHaveLength(6);
    await twoPlayers.scrawl(legsBelow(heart).map((stroke) => [...stroke]));

    twoPlayers.hud.handlers.onTidinessChanged(1);
    await twoPlayers.wait(600);
    expect(eyes.tidiedAs).toEqual([]);
    expect(drawnLook(twoPlayers).body.strokes).toHaveLength(8);
  });

  it("grafts legs drawn onto a legless body, and says so", async () => {
    const heart = soulOf(player);
    const legless = figureAround(heart)
      .slice(0, 4)
      .map((stroke, index) =>
        index < 2 ? stroke : stroke.map((point) => ({ ...point, y: point.y - 10 })),
      );
    player.game.onCommit(drawingOf("body", ...legless));
    await player.write("alice", { x: heart.x, y: heart.y + 15 });
    expect(drawnLook(player).abilities.walk).toBe(false);
    expect(player.written).toContain(INCARNATED_PARTS_LINE(["head", "arms"]));

    await player.wait(500);
    const current = player.alice;
    if (current.look.kind !== "drawn") throw new Error("drawing did not incarnate");
    const bodyHeart = {
      x: current.center.x + current.look.body.heart.x * current.look.scale,
      y: current.center.y + current.look.body.heart.y * current.look.scale,
    };
    const legs = legsBelow(bodyHeart).map((stroke) =>
      stroke.map((point) => ({
        ...point,
        y: bodyHeart.y + (point.y - bodyHeart.y) * 0.6,
      })),
    );
    await player.scrawl(legs.map((stroke) => [...stroke]));
    expect(drawnLook(player).abilities.walk).toBe(true);
    expect(drawnLook(player).body.strokes).toHaveLength(6);
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    expect(player.written).toContain(PART_RESTORED_LINE(["legs"]));
  });

  it("opens the room again once the heart is swallowed", async () => {
    const heart = soulOf(player);
    player.game.onCommit(drawingOf("body", ringAround(heart, 14)));
    await player.write("her", { x: heart.x, y: heart.y + 15 });
    expect(player.renderer.lastFrame?.world.alice).not.toBeNull();

    expect(await player.until(() => player.written.includes(HEART_SWALLOWED_LINE))).toBe(true);
    expect(player.renderer.lastFrame?.world.alice).toBeNull();
    expect(tearOf(player)).toBeNull();

    expect(
      await player.until(
        () =>
          player.written.includes(SOUL_WAITS_LINE) &&
          !player.written.includes(HEART_SWALLOWED_LINE),
        20_000,
      ),
    ).toBe(true);
    expect(soulOf(player).x).toBeCloseTo(heart.x, 0);
    expect(player.hud.cards.at(-1)).toMatchObject({
      title: "Again",
      tagline:
        "It took the heart. Draw her a body around it and write who she is — faster this time.",
    });
  });

  it("shows the Boss win card when the tear closes", async () => {
    (player.game as unknown as { celebrate: (event: { type: "tear-closed" }) => void }).celebrate({
      type: "tear-closed",
    });
    expect(player.hud.cards.at(-1)).toMatchObject({
      title: "The tear is closed",
      tagline: "It went back under the page. She is whole enough. Draw on, or start again.",
    });
  });
});
