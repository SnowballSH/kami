import type { Autopilot, Scene } from "../autopilot/types";
import type { BoardDefinition, Zone } from "../board/types";
import type { Cat, Ruling } from "../cat/types";
import {
  boundsOf,
  clamp,
  type PenPoint,
  poseToWorld,
  type Rect,
  rectGap,
  type Stroke,
  strokesLength,
  type Vec,
} from "../core/geometry";
import { INPUT_LIMITS, isInputPoint, TEXT_LIMIT_MESSAGE } from "../core/inputLimits";
import { BULLET_TIME_SCALE, FIXED_STEP_MS } from "../core/world";
import type { Handwriting } from "../handwriting/types";
import { judgePlacement } from "../ink/placement";
import type {
  Drawing,
  DrawingId,
  InkSession,
  InkSessionListener,
  PlacementRejection,
  PosedDrawing,
} from "../ink/types";
import { allowsLaw, createDirector, EMBODIED_MODE, EmbodiedDirector } from "../modes";
import type { GameMode, ModeDirector } from "../modes/types";
import type { Note, NoteAction, NoteId } from "../notes/types";
import type { BoardSnapshot, BoardStore } from "../persistence/types";
import type { PenReader } from "../reading/types";
import type { LiveRecognizer, Sighting } from "../recognition/types";
import type { Renderer } from "../render/types";
import { destinationOf, placeCalled } from "../rules";
import type {
  CompiledRule,
  Scene as Destination,
  Rule,
  RuleCompiler,
  RuleId,
  SceneCompiler,
  WorldPhysics,
} from "../rules/types";
import type { DrawingPose, SimEvent, Simulation, WalkIntent } from "../sim/types";
import { placeProp, type Summoner, type Wish } from "../summoning";
import type {
  CanvasInputSink,
  Hud,
  HudHandlers,
  LawsPanel,
  LawsPanelHandlers,
  Tool,
} from "../ui/types";
import type { EarsHandlers, Voice } from "../voice/types";
import { CameraRig } from "./cameraRig";
import { FixedStepLoop } from "./fixedStepLoop";
import { HeldInkBook } from "./heldInk";
import { IdMint } from "./idMint";
import { InkLedger, type InkRecord } from "./inkLedger";
import {
  ALICE_CORNERED_LINE,
  ALICE_FLEES_LINES,
  aloud,
  BLANK_BOARD_BRIEF,
  CANNOT_DRAW_LINE,
  DOOR_OPENED_LINE,
  GOAL_LINE,
  GROW_BLOCKED_LINE,
  glossOf,
  isHelpRequest,
  KEY_TAKEN_LINE,
  LAW_OUTSIDE_MODE_LINE,
  NOWHERE_LINE,
  OFFER_HELP_HINT,
  PONDERING_LINE,
  PORTAL_LONELY_LINE,
  REJECTION_LINES,
  RULE_REPEALED_LINE,
  SHRUGS,
  STUCK_LINE,
  SUMIKUI_ALICE_DEVOURED_LINES,
  SUMIKUI_DEVOURED_LINES,
  SUMIKUI_LORE_LINE_DELAY_MS,
  SUMIKUI_PAPER_BITTEN_LINES,
  SUMIKUI_SEALED_LINE,
  SUMIKUI_SUMMONED_LINES,
  SUMIKUI_WOKE_LINE,
  sceneGlossOf,
  TAGLINE,
  WARPED_LINES,
  WORDMARK,
} from "./lines";
import { type NoteAnchor, NoteBook } from "./noteBook";
import type { Drift } from "./noteLayout";
import { groupedByNote, RuleBook } from "./ruleBook";
import { StuckDetector } from "./stuckDetector";

const MAX_STEPS_PER_FRAME = 5;
export const DEFAULT_TIDINESS = 0.5;
const RETIDY_AFTER_MS = 350;
const MOST_RETIDIED = 12;
const ERASER_TOLERANCE = 18;
const NAMING_REACH = 190;
const GUESS_OFFSET = { x: 30, y: -4, line: 42 } as const;

const directorFor = (mode: GameMode): ModeDirector =>
  createDirector(mode) ?? new EmbodiedDirector(EMBODIED_MODE);

const guessCornerOf = (strokes: readonly Stroke[]): Vec => {
  const bounds = boundsOf(strokes.flat());
  return { x: bounds.x + bounds.width + GUESS_OFFSET.x, y: bounds.y + GUESS_OFFSET.y };
};
const GUESS_LIFETIME_MS = 20_000;
const GLIMPSE_LIFETIME_MS = 8_000;
const REMARK_LIFETIME_MS = 6_000;
const HINT_LIFETIME_MS = 14_000;
const ABOVE_ALICE = { x: -90, y: -120 } as const;
/** Where a spoken note lands: beside Alice, as if the player had written it there. */
const SPOKEN_AT = { x: -60, y: -190 } as const;
const WORDMARK_OFFSET = { x: -70, y: -360 } as const;
const TAGLINE_DROP = 46;
const ALREADY_AWAKE_MS = 10_000;
/** Kami dresses a scene one prop after another, not all at once. */
const PROP_STAGGER_MS = 450;
const HUD_WRITING_GAP = 12;

interface Recital {
  readonly at: number;
  readonly line: string;
  readonly epoch: number;
}

export interface GameModules {
  readonly sim: Simulation;
  /** Alice's own mind; the keyboard and d-pad only override it while held. */
  readonly autopilot: Autopilot;
  readonly cat: Cat;
  readonly renderer: Renderer;
  readonly handwriting: Handwriting;
  /** The offline grammar: instant. */
  readonly compiler: RuleCompiler;
  /** A model behind the server (the GX10): may take seconds, so it is asked last and only if needed. */
  readonly thinker: RuleCompiler;
  readonly store: BoardStore;
  /** Reads pen strokes as words (a vision model behind the server); without one, ink is only ink. */
  readonly penReader?: PenReader;
  /** Tidies a drawing once it has a name; without one the player's ink stays exactly as drawn. */
  readonly finisher?: Pick<LiveRecognizer, "complete">;
  /** Pictures Kami can draw himself ("summon a rabbit"); without one he must ask the player to. */
  readonly summoner?: Summoner;
  /** Places to be teleported to ("teleport us to the moon"); without one Kami knows no way there. */
  readonly scenes?: SceneCompiler;
  readonly resolvePhysics: (rules: readonly Rule[]) => WorldPhysics;
  readonly boardFor: (id: string) => BoardDefinition;
  readonly createInkSession: (listener: InkSessionListener) => InkSession;
  readonly createHud: (handlers: HudHandlers) => Hud;
  /** Deepgram both ways (docs/voice.md); without one Kami only reads and writes. */
  readonly createVoice?: (handlers: EarsHandlers) => Voice;
  readonly createLawsPanel: (handlers: LawsPanelHandlers) => LawsPanel;
  readonly findDrawingAt: (
    point: Vec,
    drawings: readonly PosedDrawing[],
    tolerance: number,
  ) => DrawingId | null;
  readonly onBoardOpened?: (boardId: string) => void;
  /** How the board is played; `EMBODIED_MODE` unless said otherwise. A mode nobody has built a director for yet plays as embodied. */
  readonly mode?: GameMode;
  /** Whether Alice starts out walking herself; the player can switch it from the HUD. */
  readonly selfDriving?: boolean;
  readonly onSelfDrivingChanged?: (enabled: boolean) => void;
  /** How firmly Kami tidies a named drawing: 0 not at all, 1 as firm as he gets. */
  readonly tidiness?: number;
  readonly onTidinessChanged?: (tidiness: number) => void;
}

export class Game implements CanvasInputSink, InkSessionListener, HudHandlers, LawsPanelHandlers {
  private readonly ink: InkSession;
  private readonly penReader: PenReader | null;
  private readonly hud: Hud;
  private readonly laws: LawsPanel;
  private readonly voice: Voice | null;
  private voiceReady = false;
  private readonly loop = new FixedStepLoop(FIXED_STEP_MS, MAX_STEPS_PER_FRAME);
  private readonly ledger = new InkLedger();
  private readonly notes: NoteBook;
  private readonly rules: RuleBook;
  private readonly camera = new CameraRig();
  private readonly stuck = new StuckDetector();
  private readonly ids = new IdMint();
  private readonly introduced = new Set<string>();
  private readonly director: ModeDirector;

  private board: BoardDefinition;
  private epoch = 0;
  private retryingPersistence = false;
  private readonly knownBoards = new Set<string>();
  private lastSubmittedAt = 0;
  private loading = false;
  private nowMs = 0;
  private lastFrameMs = 0;
  private tool: Tool = "draw";
  private manualIntent: WalkIntent = IDLE_INTENT;
  private wasStuck = false;
  private wasFleeing = false;
  private flights = 0;
  private selfDriving: boolean;
  private tidiness: number;
  private hasAskedWhatItIs = false;
  private shrugs = 0;
  private sumikuiLoose = false;
  private meals = 0;
  private bites = 0;
  private swallows = 0;
  private warps = 0;
  private recital: Recital[] = [];
  /** Settled ink the pen reader is still reading: weightless until it is known to be a drawing. */
  private readonly held = new HeldInkBook();
  private glimpsing = false;
  private glimpseAgain = false;
  private glimpse: { readonly noteId: NoteId; readonly word: string } | null = null;
  /** Labels Kami wrote for drawings he was sure of: the one kind of note of his that is kept. */
  private readonly labelsByKami = new Set<NoteId>();
  private readonly tidied = new Set<DrawingId>();
  private readonly tidyTurns = new Map<DrawingId, number>();
  private retidyDueAtMs: number | null = null;

  constructor(
    private readonly modules: GameModules,
    initialBoardId: string,
  ) {
    this.board = modules.boardFor(initialBoardId);
    this.director = directorFor(modules.mode ?? EMBODIED_MODE);
    this.selfDriving = (modules.selfDriving ?? true) && this.walksHerself();
    this.tidiness = clamp(modules.tidiness ?? DEFAULT_TIDINESS, 0, 1);
    this.notes = new NoteBook(modules.handwriting);
    this.rules = new RuleBook((rules) =>
      modules.resolvePhysics(rules.filter((rule) => this.allowsRule(rule))),
    );
    this.ink = modules.createInkSession(this);
    this.penReader = modules.penReader ?? null;
    this.hud = modules.createHud(this);
    this.laws = modules.createLawsPanel(this);
    modules.summoner?.wake();
    this.voice = modules.createVoice?.(this.ears()) ?? null;
  }

  get currentTool(): Tool {
    return this.tool;
  }

  start(nowMs: number): Promise<void> {
    this.nowMs = nowMs;
    this.lastFrameMs = nowMs;
    this.hud.setTool(this.tool);
    this.hud.setAutopilot(this.selfDriving);
    this.hud.setTidiness(this.tidiness);
    return this.open(this.board.id);
  }

  frame(nowMs: number): void {
    this.hud.setPersistence(this.modules.store.state(this.board.id));
    const { sim, renderer } = this.modules;
    const steps = this.loop.advance(nowMs - this.lastFrameMs);
    this.nowMs = nowMs;
    this.lastFrameMs = nowMs;

    sim.setTimeScale(this.ink.isDrawing || this.held.isHolding ? BULLET_TIME_SCALE : 1);
    for (let step = 0; !this.loading && step < steps; step++) {
      sim.setWalkIntent(this.chooseIntent());
      for (const event of sim.step()) this.handle(event);
    }
    this.ink.update(nowMs, {
      noInkZones: this.board.noInkZones,
      aliceBounds: sim.aliceBounds(),
    });
    if (!this.ink.isDrawing) this.forgetGlimpse();
    this.notes.expire(nowMs);
    this.speakDueRecital();
    if (this.retidyDueAtMs !== null && nowMs >= this.retidyDueAtMs) this.retidyTheBoard();
    if (this.stuck.isStuck(nowMs)) this.offerHelp();
    this.camera.follow(sim.aliceBounds(), renderer.viewport());
    this.camera.turnTo(sim.paperAngle());

    const world = sim.snapshot();
    renderer.render({
      nowMs,
      camera: this.camera.camera,
      world,
      daylight: this.rules.physics.daylight,
      inks: this.ledger.views(world.drawings, nowMs),
      notes: this.notes.views(nowMs),
      activeStrokes: this.ink.activeStrokes,
      activeVerdict: this.ink.activeVerdict,
      heldInks: this.held.views(nowMs),
      eraserActive: this.tool === "erase",
    });
  }

  penDown(client: PenPoint): void {
    if (this.loading) return;
    if (this.tool === "erase") this.eraseAt(this.toWorld(client));
    else this.ink.penDown(this.penPointToWorld(client));
  }

  penMove(client: PenPoint): void {
    if (this.loading) return;
    if (this.tool === "erase") this.eraseAt(this.toWorld(client));
    else this.ink.penMove(this.penPointToWorld(client));
  }

  penUp(): void {
    if (this.loading) return;
    this.ink.penUp();
    if (this.ink.isDrawing) void this.glimpseInk();
    this.penReader?.glimpse([...this.ink.activeStrokes]);
  }

  penCancel(): void {
    this.ink.penCancel();
  }

  tap(client: Vec): void {
    if (this.loading) return;
    const world = this.toWorld(client);
    const offered = this.notes.at(world, (note) => note.action !== undefined);
    if (offered?.action !== undefined) this.perform(offered.action, offered);
    else if (this.tool === "write") void this.promptAt(client, world);
  }

  panBy(deltaClient: Vec): void {
    this.camera.panBy(deltaClient);
  }

  zoomAt(client: Vec, factor: number): void {
    this.camera.zoomAt(client, factor, this.modules.renderer.toWorld.bind(this.modules.renderer));
  }

  onCommit(drawing: Drawing): void {
    if (this.loading) return;
    if (this.penReader === null) {
      this.land(drawing);
      return;
    }
    const known = this.penReader.recall(drawing.strokes);
    const reading = this.penReader.settle(drawing.strokes);
    if (known === null) {
      this.land(drawing);
      return;
    }
    this.held.hold(drawing.id, drawing.strokes);
    void this.settleWords(drawing, reading);
  }

  onReject(reason: PlacementRejection, strokes: readonly Stroke[]): void {
    if (this.penReader === null || reason === "too-detailed" || reason === "out-of-bounds") {
      this.remark(REJECTION_LINES[reason]);
      return;
    }
    const known = this.penReader.recall(strokes);
    const reading = this.penReader.settle(strokes);
    if (typeof known === "string") {
      void this.interpret(known, writingOrigin(strokes));
      return;
    }
    this.remark(REJECTION_LINES[reason]);
    if (known === undefined) void this.readWords(strokes, reading);
  }

  onWalkIntent(intent: WalkIntent): void {
    this.manualIntent = intent;
    if (intent.x !== 0) this.camera.resumeFollowing();
    else this.modules.autopilot.invalidate();
  }

  onToolChanged(tool: Tool): void {
    this.tool = tool;
  }

  onZoom(factor: number): void {
    const { width, height } = this.modules.renderer.viewport();
    this.zoomAt({ x: width / 2, y: height / 2 }, factor);
  }

  onTidinessChanged(tidiness: number): void {
    this.tidiness = clamp(tidiness, 0, 1);
    this.modules.onTidinessChanged?.(this.tidiness);
    this.retidyDueAtMs = this.nowMs + RETIDY_AFTER_MS;
  }

  onAutopilotToggled(enabled: boolean): void {
    this.selfDriving = enabled && this.walksHerself();
    this.wasStuck = false;
    this.wasFleeing = false;
    this.modules.autopilot.reset();
    this.hud.setAutopilot(this.selfDriving);
    this.modules.onSelfDrivingChanged?.(this.selfDriving);
  }

  private walksHerself(): boolean {
    return this.director.mode.autopilot === "allowed";
  }

  onRecenter(): void {
    this.camera.frame(this.aliceFeet(), this.modules.renderer.viewport());
  }

  onOpenBoard(boardId: string): void {
    void this.open(boardId);
  }

  onNewBoard(): void {
    void this.open(this.ids.next("sketch"));
  }

  onTalkStarted(): void {
    if (!this.voiceReady) return;
    this.voice?.hold();
  }

  onTalkEnded(): void {
    this.voice?.release();
  }

  onWakeToggled(enabled: boolean): void {
    if (enabled && !this.voiceReady) return;
    this.voice?.wake(enabled);
  }

  /** Speech is another way of writing: what the player said goes into the one funnel, as a note. */
  private ears(): EarsHandlers {
    return {
      onHearing: () => {},
      onHeard: (text) => {
        if (!this.voiceReady) return;
        const alice = this.modules.sim.aliceBounds();
        void this.interpret(text, { x: alice.x + SPOKEN_AT.x, y: alice.y + SPOKEN_AT.y });
      },
      onListeningChanged: (listening) => this.hud.setListening(listening),
      onWakingChanged: (waking) => this.hud.setWaking(waking),
    };
  }

  onRepealLaw(id: RuleId): void {
    const law = this.rules.all.find((rule) => rule.id === id);
    if (law !== undefined) this.eraseNote(law.noteId);
  }

  onClearBoard(): void {
    this.modules.store.clear(this.board.id);
    void this.open(this.board.id, { remember: false });
  }

  async onRetryPersistence(): Promise<void> {
    const { store } = this.modules;
    const state = store.state(this.board.id);
    if (this.retryingPersistence || state.loading || state.saving) return;
    this.retryingPersistence = true;
    const epoch = this.epoch;
    const boardId = this.board.id;
    try {
      await store.retry(boardId);
      if (epoch !== this.epoch) return;
      if (state.errors.some(({ operation }) => operation === "load")) await this.open(boardId);
      else await this.listBoards(epoch);
    } finally {
      this.retryingPersistence = false;
    }
  }

  private async open(boardId: string, { remember = true } = {}): Promise<void> {
    const { sim, cat, renderer, store, boardFor, onBoardOpened } = this.modules;
    this.epoch += 1;
    const epoch = this.epoch;
    this.loading = remember;
    this.voiceReady = false;
    this.voice?.cancel();
    this.board = boardFor(boardId);

    sim.loadBoard(this.board);
    this.director.open(this.board);
    this.voice?.hush();
    this.modules.autopilot.reset();
    this.wasStuck = false;
    this.wasFleeing = false;
    renderer.setBoard(this.board);
    this.ink.reset(Number.POSITIVE_INFINITY);
    this.penReader?.forget();
    this.held.clear();
    this.tidied.clear();
    this.tidyTurns.clear();
    this.retidyDueAtMs = null;
    this.ledger.clear();
    this.notes.clear();
    this.labelsByKami.clear();
    this.glimpse = null;
    this.rules.replaceAll([]);
    this.showLaws();
    this.applyLaws({ silently: true });
    this.introduced.clear();
    this.hasAskedWhatItIs = false;
    this.stuck.reset(this.nowMs);
    this.camera.frame(this.board.spawn, renderer.viewport());
    this.writeWordmark();
    const [firstZone] = this.board.zones;
    if (firstZone === undefined) cat.enterRoom(BLANK_BOARD_BRIEF);
    else this.introduce(firstZone);
    onBoardOpened?.(boardId);
    void this.listBoards(epoch);

    if (!remember) {
      this.voiceReady = true;
      return;
    }
    const loadingNote = this.kamiWrites("Loading board…", this.board.spawn);
    try {
      const snapshot = await store.load(boardId);
      if (epoch === this.epoch) this.restore(snapshot);
    } catch {
      // The store exposes the failure; drawing remains available.
    } finally {
      if (epoch === this.epoch) {
        this.notes.remove(loadingNote.id);
        this.loading = false;
        this.voiceReady = true;
      }
    }
  }

  private restore({ drawings, notes, rules }: BoardSnapshot): void {
    const { sim } = this.modules;
    for (const entry of [...notes, ...rules]) {
      this.lastSubmittedAt = Math.max(this.lastSubmittedAt, entry.createdAt);
    }
    for (const { drawing, ruling } of drawings) {
      sim.addDrawing(drawing);
      this.ledger.add(drawing);
      if (ruling === null) continue;
      sim.applyRuling(drawing.id, ruling);
      this.ledger.awaken(drawing.id, ruling, this.nowMs - ALREADY_AWAKE_MS);
    }
    for (const note of notes) {
      this.notes.restore(note, this.nowMs);
      if (!isPlayers(note)) this.labelsByKami.add(note.id);
    }
    this.rules.replaceAll(rules);
    this.showLaws();
    for (const [noteId, ofNote] of groupedByNote(rules)) {
      if (ofNote.every((rule) => this.allowsRule(rule)))
        this.writeGloss(noteId, glossOf(ofNote.map((rule) => rule.explanation).join(", ")));
      else this.refuseLaw(noteId);
    }
    this.applyLaws({ silently: true });
    this.modules.autopilot.invalidate();
  }

  /** Held keys drive her; otherwise she drives herself, unless the player switched that off. */
  private chooseIntent(): WalkIntent {
    const { autopilot } = this.modules;
    const steered = this.manualIntent.x !== 0 || this.manualIntent.y !== 0;
    if (steered || !this.selfDriving) return this.manualIntent;
    const intent = autopilot.drive(this.scene());
    const { stuck, errand } = autopilot.status;
    const fleeing = errand.kind === "flee";
    if (fleeing && !this.wasFleeing) {
      this.remark(ALICE_FLEES_LINES[this.flights++ % ALICE_FLEES_LINES.length] ?? "");
    }
    if (stuck && !this.wasStuck) this.remark(fleeing ? ALICE_CORNERED_LINE : STUCK_LINE);
    this.wasFleeing = fleeing;
    this.wasStuck = stuck;
    return intent;
  }

  private scene(): Scene {
    const { sim } = this.modules;
    const world = sim.snapshot();
    return {
      board: this.board,
      alice: world.alice,
      inks: this.ledger.sceneInks(world.drawings),
      bites: world.bites,
      sumikui: world.sumikui,
      keyTaken: world.keyTaken,
      doorOpen: world.doorOpen,
      walkSpeed: sim.walkSpeed(),
      canFly: sim.canFly(),
      bounceArc: (strength) => sim.bounceArc(strength),
      jumpArc: sim.jumpArc(),
    };
  }

  private async listBoards(epoch: number): Promise<void> {
    const demo = this.modules.boardFor("wonderland");
    this.knownBoards.add(demo.id);
    this.knownBoards.add(this.board.id);
    this.showBoards();
    try {
      const remembered = await this.modules.store.listBoards();
      if (epoch !== this.epoch) return;
      for (const summary of remembered) this.knownBoards.add(summary.id);
      this.showBoards();
    } catch {
      // Keep the known boards available while their remote list is unavailable.
    }
  }

  private showBoards(): void {
    this.hud.setBoards(
      [...this.knownBoards].map((id) => ({ id, title: this.modules.boardFor(id).title })),
      this.board.id,
    );
  }

  private handle(event: SimEvent): void {
    if (this.director.won(event)) this.remark(GOAL_LINE, HINT_LIFETIME_MS);
    switch (event.type) {
      case "goal-reached":
        return;
      case "fell":
        this.stuck.fell();
        return;
      case "zone-entered":
        this.enterZone(event.zoneId);
        return;
      case "key-taken":
        this.progress(KEY_TAKEN_LINE);
        return;
      case "door-opened":
        this.progress(DOOR_OPENED_LINE);
        return;
      case "bounced":
        this.stuck.progress(this.nowMs);
        return;
      case "consumed":
        this.discard(event.drawingId);
        this.stuck.progress(this.nowMs);
        return;
      case "perished":
        this.discard(event.drawingId);
        this.modules.autopilot.invalidate();
        return;
      case "grow-blocked":
        this.remark(GROW_BLOCKED_LINE);
        return;
      case "sumikui-woke":
        this.remark(SUMIKUI_WOKE_LINE, HINT_LIFETIME_MS);
        return;
      case "devoured":
        this.discard(event.drawingId);
        this.remark(SUMIKUI_DEVOURED_LINES[this.meals++ % SUMIKUI_DEVOURED_LINES.length] ?? "");
        return;
      case "paper-bitten":
        this.modules.autopilot.invalidate();
        this.remark(
          SUMIKUI_PAPER_BITTEN_LINES[this.bites++ % SUMIKUI_PAPER_BITTEN_LINES.length] ?? "",
        );
        return;
      case "paper-healed":
        this.modules.autopilot.invalidate();
        return;
      case "alice-devoured":
        this.modules.autopilot.invalidate();
        this.remark(
          SUMIKUI_ALICE_DEVOURED_LINES[this.swallows++ % SUMIKUI_ALICE_DEVOURED_LINES.length] ?? "",
          HINT_LIFETIME_MS,
        );
        return;
      case "warped":
        this.modules.autopilot.invalidate();
        this.stuck.progress(this.nowMs);
        this.remark(WARPED_LINES[this.warps++ % WARPED_LINES.length] ?? "");
        return;
      case "portal-lonely":
        this.remark(PORTAL_LONELY_LINE);
        return;
    }
  }

  private enterZone(zoneId: string): void {
    const zone = this.board.zones.find((candidate) => candidate.id === zoneId);
    if (zone !== undefined) this.introduce(zone);
  }

  private introduce(zone: Zone): void {
    if (this.introduced.has(zone.id)) return;
    this.introduced.add(zone.id);
    this.modules.cat.enterRoom(zone);
    this.stuck.reset(this.nowMs);
    this.kamiWrites(
      zone.intro,
      { x: zone.checkpoint.x + ABOVE_ALICE.x, y: zone.checkpoint.y + ABOVE_ALICE.y - 80 },
      { lifetimeMs: HINT_LIFETIME_MS, minY: this.writingTop() },
    );
  }

  private progress(line: string): void {
    this.remark(line);
    this.stuck.progress(this.nowMs);
  }

  private offerHelp(): void {
    const line = this.modules.cat.offerHelp();
    if (line !== null) this.remark(`${line} ${OFFER_HELP_HINT}`, HINT_LIFETIME_MS);
    this.stuck.reset(this.nowMs);
  }

  /**
   * Kami peeks at the ink between strokes and pencils in his best guess so far. Looks never
   * queue up: a stroke landing mid-look earns exactly one more look once this one is back.
   */
  private async glimpseInk(): Promise<void> {
    if (this.glimpsing) {
      this.glimpseAgain = true;
      return;
    }
    this.glimpsing = true;
    const epoch = this.epoch;
    try {
      do {
        this.glimpseAgain = false;
        const strokes = this.ink.activeStrokes.map((stroke) => [...stroke]);
        const seen = await this.modules.cat.glimpse(strokes);
        if (epoch !== this.epoch || !this.ink.isDrawing) return;
        if (seen !== null) this.writeGlimpse(seen, strokes);
      } while (this.glimpseAgain);
    } finally {
      this.glimpsing = false;
    }
  }

  private writeGlimpse(seen: Sighting, strokes: readonly Stroke[]): void {
    if (this.glimpse?.word === seen.word) return;
    this.forgetGlimpse();
    const note = this.kamiWrites(`${seen.name}?`, guessCornerOf(strokes), {
      lifetimeMs: GLIMPSE_LIFETIME_MS,
      drift: "down",
    });
    this.glimpse = { noteId: note.id, word: seen.word };
  }

  private forgetGlimpse(): void {
    if (this.glimpse === null) return;
    this.notes.remove(this.glimpse.noteId);
    this.glimpse = null;
  }

  private land(drawing: Drawing): void {
    this.modules.sim.addDrawing(drawing);
    this.modules.autopilot.invalidate();
    this.ledger.add(drawing);
    this.modules.store.saveDrawing(this.board.id, { drawing, ruling: null });
    void this.offerGuesses(drawing);
  }

  /** Held ink is let down into the world if it was a drawing, or fades away as the words it was. */
  private async settleWords(drawing: Drawing, reading: Promise<string | null>): Promise<void> {
    const epoch = this.epoch;
    const text = await reading;
    if (epoch !== this.epoch) return;
    if (text === null) {
      this.held.release(drawing.id);
      this.land(drawing);
      return;
    }
    this.held.fade(drawing.id, drawing.strokes, this.nowMs);
    this.ink.refund(drawing.cost);
    await this.interpret(text, writingOrigin(drawing.strokes));
  }

  private async readWords(
    strokes: readonly Stroke[],
    reading: Promise<string | null>,
  ): Promise<void> {
    const epoch = this.epoch;
    const text = await reading;
    if (text !== null && epoch === this.epoch) await this.interpret(text, writingOrigin(strokes));
  }

  private async offerGuesses(drawing: Drawing): Promise<void> {
    const epoch = this.epoch;
    const { certain, rulings } = await this.modules.cat.look(drawing);
    if (epoch !== this.epoch || this.ledger.get(drawing.id)?.ruling !== null) return;

    const corner = guessCornerOf(drawing.strokes);
    if (certain !== null) {
      const label = this.kamiWrites(certain.name, corner, { drift: "down" });
      this.labelsByKami.add(label.id);
      this.name(drawing.id, this.modules.cat.accept(certain), label);
      return;
    }
    const anchor: NoteAnchor = { type: "drawing", id: drawing.id };
    if (!this.hasAskedWhatItIs) {
      this.hasAskedWhatItIs = true;
      this.kamiWrites(
        this.modules.cat.askWhatItIs(),
        { x: corner.x, y: corner.y - GUESS_OFFSET.line },
        { lifetimeMs: GUESS_LIFETIME_MS, anchor, drift: "down" },
      );
    }
    rulings.forEach((ruling, index) => {
      const { name } = ruling;
      this.kamiWrites(
        `${name}?`,
        { x: corner.x, y: corner.y + index * GUESS_OFFSET.line },
        {
          lifetimeMs: GUESS_LIFETIME_MS,
          anchor,
          action: { type: "name-drawing", drawingId: drawing.id, name, ruling },
          drift: "down",
        },
      );
    });
  }

  private perform(action: NoteAction, offered: Note): void {
    const label = this.playerWrites(action.name, offered.position);
    if (action.ruling === undefined) {
      void this.nameDrawing(action.drawingId, action.name, label);
    } else {
      this.name(action.drawingId, this.modules.cat.accept(action.ruling), label);
    }
  }

  private async promptAt(client: Vec, world: Vec): Promise<void> {
    const epoch = this.epoch;
    const text = await this.hud.promptText(client);
    if (text !== null && epoch === this.epoch) await this.interpret(text, world);
  }

  /**
   * The one funnel: a request for help, a law of physics, a wish for things, a name for a drawing,
   * or a remark. Whatever is instant is tried first; the model is only asked about what nothing
   * else understood. A bare name ("a rabbit") beside a drawing names it; anywhere else it summons.
   */
  private async interpret(text: string, position: Vec): Promise<void> {
    if (text.length > INPUT_LIMITS.text) {
      this.remark(TEXT_LIMIT_MESSAGE);
      return;
    }
    if (!isInputPoint(position)) {
      this.remark(REJECTION_LINES["out-of-bounds"]);
      return;
    }
    if (isHelpRequest(text)) {
      this.kamiWrites(this.modules.cat.hint().line, position, { lifetimeMs: HINT_LIFETIME_MS });
      return;
    }
    const note = this.playerWrites(text, position);
    const stillHere = this.witness(note.id);

    const law = await this.modules.compiler.compile(text);
    if (!stillHere()) return;
    if (law !== null) {
      this.enactIfAllowed(this.ruleFrom(law, note));
      return;
    }

    const where = destinationOf(text);
    if (where !== null) {
      const scene = await this.sceneOf(text, where, note.id);
      if (!stillHere()) return;
      if (scene !== null) {
        await this.travel(scene, note, stillHere);
        return;
      }
    }

    const subject = this.drawingNear(note.id);
    const nameless = subject !== null && subject.ruling === null;
    const wish = (await this.modules.summoner?.wish(text)) ?? null;
    if (!stillHere()) return;
    if (wish !== null && !nameless && (wish.explicit || subject === null)) {
      await this.summon(wish, note, stillHere);
      return;
    }

    const ruling = subject === null ? null : await this.modules.cat.name(text, subject.drawing);
    if (!stillHere()) return;
    if (subject !== null && ruling !== null && ruling.nature !== "ink") {
      this.name(subject.drawing.id, ruling, note);
      return;
    }
    if (wish !== null && !nameless) {
      await this.summon(wish, note, stillHere);
      return;
    }

    const thought = await this.ponder(text, note.id);
    if (!stillHere()) return;
    if (thought !== null) this.enactIfAllowed(this.ruleFrom(thought, note));
    else if (subject !== null && ruling !== null) this.name(subject.drawing.id, ruling, note);
    else if (where !== null) this.remarkUnder(note.id, NOWHERE_LINE(where));
    else this.shrug(note.id);
  }

  /**
   * Kami draws what was asked for: a finished drawing of each thing from the server, standing over
   * the words in a row, inked in stroke by stroke, solid at once and named as it would be had the
   * player drawn it. Things that would land in a no-ink zone are left out.
   */
  private async summon(wish: Wish, note: Note, stillHere: () => boolean): Promise<void> {
    const { summoner, sim } = this.modules;
    const writing = this.notes.boundsOf(note.id);
    const summoned =
      summoner === undefined || writing === null
        ? []
        : await summoner.conjure(wish, writing, sim.aliceBounds());
    if (!stillHere()) return;
    const rules = { noInkZones: this.board.noInkZones, aliceBounds: null };
    const landed = summoned.filter(({ strokes }) => judgePlacement(strokes, rules) === "ok");
    if (landed.length === 0) {
      this.remarkUnder(note.id, CANNOT_DRAW_LINE(wish.asked));
      return;
    }
    const drawings = landed.map(({ word, strokes }, index) => ({
      word,
      drawing: this.conjure(strokes, this.nowMs + index * PROP_STAGGER_MS),
    }));
    const [only] = drawings;
    if (only !== undefined && drawings.length === 1) {
      const ruling = await this.modules.cat.name(only.word, only.drawing);
      if (stillHere() && this.ledger.get(only.drawing.id) !== null)
        this.name(only.drawing.id, ruling, note);
      return;
    }
    this.understood(note.id);
    for (const { word, drawing } of drawings) void this.label(drawing, word);
  }

  /** Ink of Kami's own: whole and solid at once, shown being drawn in from `fromMs`. */
  private conjure(strokes: readonly Stroke[], fromMs: number): Drawing {
    const drawing: Drawing = {
      id: this.ids.next<DrawingId>("drawing"),
      strokes,
      cost: strokesLength(strokes),
    };
    this.modules.sim.addDrawing(drawing);
    this.modules.autopilot.invalidate();
    this.ledger.conjure(drawing, fromMs);
    this.tidied.add(drawing.id);
    this.modules.store.saveDrawing(this.board.id, { drawing, ruling: null });
    return drawing;
  }

  /**
   * "Teleport us to the moon": every law of the place is enacted at once, all bound to the one
   * note (erase it, or tap the scene in the laws panel, and everyone comes home), and Kami dresses
   * the place with props of his own, one after another. A place the mode forbids is refused whole.
   */
  private async travel(scene: Destination, note: Note, stillHere: () => boolean): Promise<void> {
    const rules = scene.laws.map((law) => this.ruleFrom(law, note));
    if (!rules.every((rule) => this.allowsRule(rule))) {
      this.refuseLaw(note.id);
      return;
    }
    this.enactAll(
      rules,
      note.id,
      sceneGlossOf(
        scene.place,
        rules.map((rule) => rule.explanation),
      ),
    );
    this.remark(scene.line);
    await this.dress(scene, note, stillHere);
  }

  private async dress(scene: Destination, note: Note, stillHere: () => boolean): Promise<void> {
    const summoner = this.modules.summoner;
    if (summoner === undefined) return;
    const pictures = await Promise.all(
      scene.props.map(async (prop) => ({ prop, exemplar: await summoner.exemplar(prop.word) })),
    );
    const writing = this.notes.boundsOf(note.id);
    if (!stillHere() || writing === null) return;
    let drawnIn = 0;
    for (const { prop, exemplar } of pictures) {
      if (exemplar === null) continue;
      const strokes = placeProp(exemplar.strokes, writing, prop, this.modules.sim.aliceBounds());
      const drawing = this.conjure(strokes, this.nowMs + drawnIn * PROP_STAGGER_MS);
      drawnIn += 1;
      void this.label(drawing, exemplar.word);
    }
  }

  /** Kami names a drawing of his own, writing the word beside it, without a word more. */
  private async label(drawing: Drawing, word: string): Promise<void> {
    const epoch = this.epoch;
    const ruling = await this.modules.cat.name(word, drawing);
    if (epoch !== this.epoch || this.ledger.get(drawing.id) === null) return;
    const label = this.kamiWrites(ruling.name, guessCornerOf(drawing.strokes), { drift: "down" });
    this.labelsByKami.add(label.id);
    this.name(drawing.id, ruling, label, { quietly: true });
  }

  private witness(noteId: NoteId): () => boolean {
    const epoch = this.epoch;
    return () => epoch === this.epoch && this.notes.get(noteId) !== null;
  }

  private ponder(text: string, noteId: NoteId): Promise<CompiledRule | null> {
    return this.whilePondering(noteId, () => this.modules.thinker.compile(text));
  }

  /** A place the atlas knows is there at once; for anywhere else the model is asked, and Kami says so. */
  private async sceneOf(text: string, where: string, noteId: NoteId): Promise<Destination | null> {
    const scenes = this.modules.scenes;
    if (scenes === undefined) return null;
    if (placeCalled(where) !== null) return scenes.compile(text);
    return this.whilePondering(noteId, () => scenes.compile(text));
  }

  private async whilePondering<Thought>(
    noteId: NoteId,
    think: () => Promise<Thought>,
  ): Promise<Thought> {
    const under = this.notes.below(noteId);
    const pondering: NoteAnchor = { type: "note", id: noteId };
    if (under !== null)
      this.kamiWrites(PONDERING_LINE, under, { anchor: pondering, drift: "down" });
    try {
      return await think();
    } finally {
      this.notes.removeAnchoredTo(pondering);
    }
  }

  private ruleFrom(compiled: CompiledRule, note: Note): Rule {
    return {
      ...compiled,
      id: this.ids.next<RuleId>("rule"),
      sourceText: note.text,
      noteId: note.id,
      position: note.position,
      createdAt: note.createdAt,
    };
  }

  private allowsRule(rule: Rule): boolean {
    return allowsLaw(this.director.mode.laws, rule.effect.governs);
  }

  private enactIfAllowed(rule: Rule): void {
    if (this.allowsRule(rule)) this.enact(rule);
    else this.refuseLaw(rule.noteId);
  }

  private refuseLaw(noteId: NoteId): void {
    this.notes.restyle(noteId, "plain");
    const under = this.notes.below(noteId);
    if (under !== null) {
      this.kamiWrites(LAW_OUTSIDE_MODE_LINE, under, {
        anchor: { type: "note", id: noteId },
        lifetimeMs: REMARK_LIFETIME_MS,
        drift: "down",
      });
    }
  }

  private enact(rule: Rule): void {
    this.enactAll([rule], rule.noteId, glossOf(rule.explanation));
  }

  private enactAll(rules: readonly Rule[], noteId: NoteId, gloss: string): void {
    for (const rule of rules) {
      this.rules.enact(rule);
      this.modules.store.saveRule(this.board.id, rule);
    }
    this.showLaws();
    this.applyLaws({ silently: false });
    this.modules.autopilot.invalidate();
    this.understood(noteId);
    this.writeGloss(noteId, gloss);
    this.stuck.progress(this.nowMs);
  }

  private async nameDrawing(id: DrawingId, name: string, label: Note): Promise<void> {
    const epoch = this.epoch;
    const record = this.ledger.get(id);
    if (record === null) return;
    const ruling = await this.modules.cat.name(name, record.drawing);
    if (epoch === this.epoch) this.name(id, ruling, label);
  }

  private name(
    id: DrawingId,
    ruling: Ruling,
    label: Note,
    { quietly = false }: { readonly quietly?: boolean } = {},
  ): void {
    const awake = this.ledger.awaken(id, ruling, this.nowMs);
    if (awake === null) return;

    this.modules.sim.applyRuling(id, ruling);
    this.modules.autopilot.invalidate();
    this.modules.store.saveDrawing(this.board.id, { drawing: awake.drawing, ruling });
    this.forget(this.notes.removeAnchoredTo({ type: "drawing", id }));
    const attached = this.notes.attachToDrawing(label.id, id);
    if (ruling.nature !== "ink") this.understood(label.id);
    else if (attached !== null) this.modules.store.saveNote(this.board.id, attached);
    const under = quietly ? null : this.notes.below(label.id);
    if (under !== null) {
      this.kamiWrites(ruling.line, under, { lifetimeMs: REMARK_LIFETIME_MS, drift: "down" });
    }
    this.stuck.progress(this.nowMs);
    void this.tidy(id, ruling.name);
  }

  /**
   * Kami tidies what has just been named: the ink glides into the player's own strokes, steadied,
   * and whatever a finished drawing of it was missing is drawn in. Once per drawing. The body Alice
   * stands on stays as drawn until the board is next opened; the tidied strokes differ from it by
   * less than a pen's width.
   */
  private async tidy(id: DrawingId, name: string): Promise<void> {
    if (this.tidied.has(id) || this.tidiness <= 0) return;
    this.tidied.add(id);
    await this.retidy(id, name);
  }

  /**
   * Always from the strokes as drawn, so tidying twice is not tidying squared and the slider can be
   * moved back. The latest request for a drawing wins; an answer for a name that no longer stands,
   * a drawing that is gone or another board is dropped.
   */
  private async retidy(id: DrawingId, name: string): Promise<void> {
    const finisher = this.modules.finisher;
    const before = this.ledger.get(id);
    if (finisher === undefined || before === null) return;
    const epoch = this.epoch;
    const turn = (this.tidyTurns.get(id) ?? 0) + 1;
    this.tidyTurns.set(id, turn);
    const completion =
      this.tidiness <= 0 ? null : await finisher.complete(before.drawn, name, this.tidiness);
    const current = this.ledger.get(id);
    if (epoch !== this.epoch || current === null || this.tidyTurns.get(id) !== turn) return;
    if (current.ruling !== before.ruling) {
      if (current.ruling !== null) await this.retidy(id, current.ruling.name);
      return;
    }
    const strokes =
      completion === null ? current.drawn : [...completion.tidied, ...completion.added];
    if (completion === null && (this.tidiness > 0 || current.drawing.strokes === current.drawn)) {
      return;
    }
    const retraced = this.ledger.retrace(id, strokes, this.nowMs);
    if (retraced === null) return;
    this.modules.store.saveDrawing(this.board.id, {
      drawing: retraced.drawing,
      ruling: retraced.ruling,
    });
  }

  /** The slider came to rest: what is already named is tidied again at the new firmness. */
  private retidyTheBoard(): void {
    this.retidyDueAtMs = null;
    const named = this.ledger
      .named()
      .slice(-MOST_RETIDIED)
      .flatMap(({ drawing, ruling }) => (ruling === null ? [] : [{ id: drawing.id, ruling }]));
    for (const { id, ruling } of named) {
      this.tidied.add(id);
      void this.retidy(id, ruling.name);
    }
  }

  private shrug(noteId: NoteId): void {
    const line = SHRUGS[this.shrugs % SHRUGS.length];
    this.shrugs += 1;
    if (line !== undefined) this.remarkUnder(noteId, line);
  }

  private remarkUnder(noteId: NoteId, line: string): void {
    const under = this.notes.below(noteId);
    if (under !== null) {
      this.kamiWrites(line, under, { lifetimeMs: REMARK_LIFETIME_MS, drift: "down" });
    }
  }

  private understood(noteId: NoteId): void {
    const note = this.notes.restyle(noteId, "understood");
    if (note !== null) this.modules.store.saveNote(this.board.id, note);
  }

  /** One entry per note: a scene's laws share their words and are repealed together. */
  /** One entry per note: a scene's several laws stand together, and are repealed together. */
  private showLaws(): void {
    const standing = this.rules.all.filter((rule) => this.allowsRule(rule));
    this.laws.setLaws(
      [...groupedByNote(standing).values()].map((ofNote) => ({
        id: ofNote[0].id,
        text: ofNote[0].sourceText,
        gloss: ofNote.map((rule) => rule.explanation).join(", "),
      })),
    );
  }

  private writeGloss(noteId: NoteId, gloss: string): void {
    const under = this.notes.below(noteId);
    if (under === null) return;
    this.kamiWrites(gloss, under, {
      anchor: { type: "note", id: noteId },
      tone: "understood",
      drift: "down",
    });
  }

  private writeWordmark(): void {
    const at = {
      x: this.board.spawn.x + WORDMARK_OFFSET.x,
      y: this.board.spawn.y + WORDMARK_OFFSET.y,
    };
    this.kamiWrites(WORDMARK, at, { silent: true });
    this.kamiWrites(TAGLINE, { x: at.x, y: at.y + TAGLINE_DROP }, { silent: true });
  }

  private playerWrites(text: string, position: Vec): Note {
    this.lastSubmittedAt = Math.max(Date.now(), this.lastSubmittedAt + 1);
    const note = this.notes.write({
      note: {
        id: this.ids.next<NoteId>("note"),
        author: "player",
        text,
        position,
        tone: "plain",
        createdAt: this.lastSubmittedAt,
        fleeting: false,
      },
      nowMs: this.nowMs,
      drift: "down",
    });
    this.modules.store.saveNote(this.board.id, note);
    return note;
  }

  private kamiWrites(
    text: string,
    position: Vec,
    options: {
      readonly lifetimeMs?: number;
      readonly anchor?: NoteAnchor;
      readonly action?: NoteAction;
      readonly tone?: Note["tone"];
      readonly drift?: Drift;
      /** Written but not said aloud: his own wordmark, and the labels he hangs on drawings. */
      readonly silent?: boolean;
      readonly minY?: number;
    } = {},
  ): Note {
    const {
      lifetimeMs,
      anchor,
      action,
      tone = "plain",
      drift = "up",
      silent = false,
      minY,
    } = options;
    if (!silent) this.voice?.say(aloud(text));
    const note: Note = {
      id: this.ids.next<NoteId>("kami"),
      author: "kami",
      text,
      position,
      tone,
      createdAt: Date.now(),
      fleeting: lifetimeMs !== undefined,
      ...(action === undefined ? {} : { action }),
    };
    return this.notes.write({
      note,
      nowMs: this.nowMs,
      drift,
      ...(lifetimeMs === undefined ? {} : { lifetimeMs }),
      ...(anchor === undefined ? {} : { anchor }),
      ...(minY === undefined ? {} : { minY }),
    });
  }

  /** Refolds the standing laws into the world; returns whether this fold sealed the Sumikui away. */
  private applyLaws({ silently }: { readonly silently: boolean }): boolean {
    const physics = this.rules.physics;
    this.modules.sim.setPhysics(physics);
    const loose = physics.inkEater > 0;
    const summoned = loose && !this.sumikuiLoose;
    const sealed = !loose && this.sumikuiLoose;
    this.sumikuiLoose = loose;
    if (sealed) this.recital = [];
    if (silently) return sealed;
    if (summoned) this.recite(SUMIKUI_SUMMONED_LINES);
    if (sealed) this.remark(SUMIKUI_SEALED_LINE);
    return sealed;
  }

  private recite(lines: readonly string[]): void {
    const epoch = this.epoch;
    this.recital = lines.map((line, index) => ({
      at: this.nowMs + index * SUMIKUI_LORE_LINE_DELAY_MS,
      line,
      epoch,
    }));
  }

  private speakDueRecital(): void {
    const due = this.recital.filter(({ at }) => at <= this.nowMs);
    if (due.length === 0) return;
    this.recital = this.recital.filter(({ at }) => at > this.nowMs);
    for (const { line, epoch } of due)
      if (epoch === this.epoch) this.remark(line, HINT_LIFETIME_MS);
  }

  private remark(line: string, lifetimeMs: number = REMARK_LIFETIME_MS): void {
    const alice = this.modules.sim.aliceBounds();
    this.kamiWrites(
      line,
      { x: alice.x + ABOVE_ALICE.x, y: alice.y + ABOVE_ALICE.y },
      { lifetimeMs, minY: this.writingTop() },
    );
  }

  private writingTop(): number {
    return this.modules.renderer.toWorld(
      { x: 0, y: this.hud.toolbarBottom() + HUD_WRITING_GAP },
      this.camera.camera,
    ).y;
  }

  private eraseAt(point: Vec): void {
    const { sim, findDrawingAt } = this.modules;
    const tolerance = ERASER_TOLERANCE / this.camera.camera.zoom;
    const id = findDrawingAt(point, this.ledger.posed(sim.snapshot().drawings), tolerance);
    if (id !== null) {
      this.discard(id);
      return;
    }
    const written = this.notes.at(point, isPlayers);
    if (written !== null) this.eraseNote(written.id);
  }

  private eraseNote(id: NoteId): void {
    this.forget(this.notes.remove(id));
    const repealed = this.rules.repealByNote(id);
    if (repealed.length === 0) return;
    this.showLaws();
    for (const rule of repealed) this.modules.store.deleteRule(this.board.id, rule.id);
    const sealed = this.applyLaws({ silently: false });
    this.modules.autopilot.invalidate();
    if (!sealed) this.remark(RULE_REPEALED_LINE);
  }

  private discard(id: DrawingId): void {
    if (this.ledger.remove(id) === null) return;
    this.modules.sim.removeDrawing(id);
    this.modules.autopilot.invalidate();
    this.modules.store.deleteDrawing(this.board.id, id);
    this.forget(this.notes.removeAnchoredTo({ type: "drawing", id }));
  }

  private forget(removed: readonly Note[]): void {
    for (const note of removed) {
      if (isPlayers(note) || this.labelsByKami.delete(note.id))
        this.modules.store.deleteNote(this.board.id, note.id);
    }
  }

  private drawingNear(noteId: NoteId): InkRecord | null {
    const written = this.notes.boundsOf(noteId);
    if (written === null) return null;
    const poses = this.modules.sim.snapshot().drawings;
    const nearest = poses
      .flatMap((pose) => {
        const record = this.ledger.get(pose.id);
        return record === null
          ? []
          : [{ record, gap: rectGap(written, currentBounds(record.drawing, pose)) }];
      })
      .filter(({ gap }) => gap <= NAMING_REACH)
      .sort((a, b) => a.gap - b.gap);
    return nearest[0]?.record ?? null;
  }

  private aliceFeet(): Vec {
    const bounds = this.modules.sim.aliceBounds();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height };
  }

  private toWorld(client: Vec): Vec {
    return this.modules.renderer.toWorld(client, this.camera.camera);
  }

  private penPointToWorld(client: PenPoint): PenPoint {
    const world = this.toWorld(client);
    return client.pressure === undefined ? world : { ...world, pressure: client.pressure };
  }
}

const IDLE_INTENT: WalkIntent = { x: 0, y: 0 };

const isPlayers = (note: Note): boolean => note.author === "player";

const writingOrigin = (strokes: readonly Stroke[]): Vec => {
  const { x, y } = boundsOf(strokes.flat());
  return { x, y };
};

const currentBounds = (drawing: Drawing, { pose }: DrawingPose): Rect =>
  boundsOf(drawing.strokes.flatMap((stroke) => stroke.map((point) => poseToWorld(point, pose))));
