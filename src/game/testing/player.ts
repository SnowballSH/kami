import { vi } from "vitest";
import { createAutopilot } from "../../autopilot";
import { boardFor } from "../../board";
import { ENDLESS_STRIP as ENDLESS_GROUND, endlessPage } from "../../board/boards/endless";
import { createCat } from "../../cat";
import type { PenPoint, Stroke, Vec } from "../../core/geometry";
import { FIXED_STEP_MS } from "../../core/world";
import { createInkSession, findDrawingAt } from "../../ink";
import type { InkSession } from "../../ink/types";
import type { GameMode } from "../../modes/types";
import type { BoardStore, Handwriting, HandwritingReader } from "../../persistence/types";
import { createPenReader } from "../../reading";
import type { Completion, Exemplar, LiveRecognizer, Sighting } from "../../recognition/types";
import { createRuleCompiler, createSceneCompiler, resolvePhysics } from "../../rules";
import type { CompiledRule, Scene } from "../../rules/types";
import { createSimulation } from "../../sim";
import type { SimEvent, Simulation } from "../../sim/types";
import { type SketchCatalogue, Summoner } from "../../summoning";
import type { BoardLink } from "../../sync/boardLink";
import type { Tool } from "../../ui/types";
import { Game } from "../game";
import { FakeHandwriting, FakeHud, FakeLawsPanel, FakeRenderer, MemoryBoardStore } from "./fakes";

export const COMMIT_WAIT_MS = 1_200;

export const bossPaceBody = (heart: Vec): readonly Stroke[] => {
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

export const line = (from: Vec, to: Vec, spacing = 8): Vec[] => {
  const count = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / spacing);
  return Array.from({ length: count + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / count,
    y: from.y + ((to.y - from.y) * i) / count,
  }));
};

export const cardLineOf = ({ card }: GameMode): string => `${card.title} — ${card.tagline}`;

export const blob = (center: Vec, rx: number, ry: number): Vec[] =>
  Array.from({ length: 25 }, (_, i) => ({
    x: center.x + rx * Math.cos((i / 24) * Math.PI * 2),
    y: center.y + ry * Math.sin((i / 24) * Math.PI * 2),
  }));

export const box = (bottomCentre: Vec, width: number, height: number): Vec[] => {
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

export const seen = (word: string, nature: Sighting["nature"], certain = false): Sighting => ({
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
export class Eyes implements LiveRecognizer, SketchCatalogue {
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
export const scrawl = (at: Vec, letters: number, spacing = 14): Vec[][] =>
  Array.from({ length: letters }, (_, i) => [
    { x: at.x + i * spacing, y: at.y },
    { x: at.x + i * spacing + 6, y: at.y + 12 },
    { x: at.x + i * spacing, y: at.y + 24 },
  ]);

/** Reads any scrawl of at least three strokes as the given words, after a delay in frames. */
export class ScriptedReader implements HandwritingReader {
  readonly asked: number[] = [];
  readonly pending: (() => void)[] = [];

  constructor(
    private readonly says: string | null,
    private readonly slow = false,
  ) {}

  read(strokes: readonly Vec[][]): Promise<Handwriting | null> {
    this.asked.push(strokes.length);
    const answer =
      strokes.length >= 3 && this.says !== null ? { text: this.says, unsure: false } : null;
    if (!this.slow) return Promise.resolve(answer);
    return new Promise((resolve) => this.pending.push(() => resolve(answer)));
  }

  answerAll(): void {
    for (const reply of this.pending.splice(0)) reply();
  }
}

export const befallHerOnce = (sim: Simulation, befalls: readonly SimEvent[]): void => {
  const step = sim.step.bind(sim);
  let befallen = false;
  vi.spyOn(sim, "step").mockImplementation(() => {
    const events = step();
    if (befallen) return events;
    befallen = true;
    return [...events, ...befalls];
  });
};

export class Player {
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
  readonly ponderedBeside: (string | null)[] = [];
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
          compile: (text, context) => {
            this.pondered.push(text);
            this.ponderedBeside.push(context?.referent ?? null);
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

  async draw(points: readonly PenPoint[]): Promise<void> {
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
