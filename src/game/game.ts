import type { Autopilot, Scene } from "../autopilot/types";
import type { BoardDefinition, Zone } from "../board/types";
import type { Cat, Ruling } from "../cat/types";
import { boundsOf, type Rect, rectGap, translateRect, type Vec } from "../core/geometry";
import { BULLET_TIME_SCALE, FIXED_STEP_MS } from "../core/world";
import type { Handwriting } from "../handwriting/types";
import type {
  Drawing,
  DrawingId,
  InkSession,
  InkSessionListener,
  PlacementRejection,
  PosedDrawing,
} from "../ink/types";
import type { Note, NoteAction, NoteId } from "../notes/types";
import type { BoardSnapshot, BoardStore } from "../persistence/types";
import type { Renderer } from "../render/types";
import type { CompiledRule, Rule, RuleCompiler, RuleId, WorldPhysics } from "../rules/types";
import type { DrawingPose, SimEvent, Simulation, WalkIntent } from "../sim/types";
import type { CanvasInputSink, Hud, HudHandlers, Tool } from "../ui/types";
import { CameraRig } from "./cameraRig";
import { FixedStepLoop } from "./fixedStepLoop";
import { IdMint } from "./idMint";
import { InkLedger, type InkRecord } from "./inkLedger";
import {
  BLANK_BOARD_BRIEF,
  DOOR_OPENED_LINE,
  GOAL_LINE,
  GROW_BLOCKED_LINE,
  glossOf,
  isHelpRequest,
  KEY_TAKEN_LINE,
  OFFER_HELP_HINT,
  PONDERING_LINE,
  REJECTION_LINES,
  RULE_REPEALED_LINE,
  SHRUGS,
  STUCK_LINE,
  SUMIKUI_DEVOURED_LINES,
  SUMIKUI_LORE_LINE_DELAY_MS,
  SUMIKUI_SEALED_LINE,
  SUMIKUI_SUMMONED_LINES,
  SUMIKUI_WOKE_LINE,
  TAGLINE,
  WORDMARK,
} from "./lines";
import { type NoteAnchor, NoteBook } from "./noteBook";
import type { Drift } from "./noteLayout";
import { RuleBook } from "./ruleBook";
import { StuckDetector } from "./stuckDetector";

const MAX_STEPS_PER_FRAME = 5;
const ERASER_TOLERANCE = 18;
const NAMING_REACH = 190;
const GUESS_OFFSET = { x: 30, y: -4, line: 42 } as const;
const GUESS_LIFETIME_MS = 20_000;
const REMARK_LIFETIME_MS = 6_000;
const HINT_LIFETIME_MS = 14_000;
const ABOVE_ALICE = { x: -90, y: -120 } as const;
const WORDMARK_OFFSET = { x: -70, y: -360 } as const;
const TAGLINE_DROP = 46;
const ALREADY_AWAKE_MS = 10_000;

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
  readonly resolvePhysics: (rules: readonly Rule[]) => WorldPhysics;
  readonly boardFor: (id: string) => BoardDefinition;
  readonly createInkSession: (listener: InkSessionListener) => InkSession;
  readonly createHud: (handlers: HudHandlers) => Hud;
  readonly findDrawingAt: (
    point: Vec,
    drawings: readonly PosedDrawing[],
    tolerance: number,
  ) => DrawingId | null;
  readonly onBoardOpened?: (boardId: string) => void;
  /** Whether Alice starts out walking herself; the player can switch it from the HUD. */
  readonly selfDriving?: boolean;
  readonly onSelfDrivingChanged?: (enabled: boolean) => void;
}

export class Game implements CanvasInputSink, InkSessionListener, HudHandlers {
  private readonly ink: InkSession;
  private readonly hud: Hud;
  private readonly loop = new FixedStepLoop(FIXED_STEP_MS, MAX_STEPS_PER_FRAME);
  private readonly ledger = new InkLedger();
  private readonly notes: NoteBook;
  private readonly rules: RuleBook;
  private readonly camera = new CameraRig();
  private readonly stuck = new StuckDetector();
  private readonly ids = new IdMint();
  private readonly introduced = new Set<string>();

  private board: BoardDefinition;
  private epoch = 0;
  private nowMs = 0;
  private lastFrameMs = 0;
  private tool: Tool = "draw";
  private manualIntent: WalkIntent = IDLE_INTENT;
  private wasStuck = false;
  private selfDriving: boolean;
  private hasAskedWhatItIs = false;
  private shrugs = 0;
  private sumikuiLoose = false;
  private meals = 0;
  private recital: Recital[] = [];

  constructor(
    private readonly modules: GameModules,
    initialBoardId: string,
  ) {
    this.board = modules.boardFor(initialBoardId);
    this.selfDriving = modules.selfDriving ?? true;
    this.notes = new NoteBook(modules.handwriting);
    this.rules = new RuleBook(modules.resolvePhysics);
    this.ink = modules.createInkSession(this);
    this.hud = modules.createHud(this);
  }

  get currentTool(): Tool {
    return this.tool;
  }

  start(nowMs: number): Promise<void> {
    this.nowMs = nowMs;
    this.lastFrameMs = nowMs;
    this.hud.setTool(this.tool);
    this.hud.setAutopilot(this.selfDriving);
    return this.open(this.board.id);
  }

  frame(nowMs: number): void {
    const { sim, renderer } = this.modules;
    const steps = this.loop.advance(nowMs - this.lastFrameMs);
    this.nowMs = nowMs;
    this.lastFrameMs = nowMs;

    sim.setTimeScale(this.ink.isDrawing ? BULLET_TIME_SCALE : 1);
    for (let step = 0; step < steps; step++) {
      sim.setWalkIntent(this.chooseIntent());
      for (const event of sim.step()) this.handle(event);
    }
    this.ink.update(nowMs, {
      noInkZones: this.board.noInkZones,
      aliceBounds: sim.aliceBounds(),
    });
    this.notes.expire(nowMs);
    this.speakDueRecital();
    if (this.stuck.isStuck(nowMs)) this.offerHelp();
    this.camera.follow(sim.aliceBounds(), renderer.viewport());

    const world = sim.snapshot();
    renderer.render({
      nowMs,
      camera: this.camera.camera,
      world,
      daylight: this.rules.physics.daylight,
      inks: this.ledger.views(world.drawings),
      notes: this.notes.views(nowMs),
      activeStrokes: this.ink.activeStrokes,
      activeVerdict: this.ink.activeVerdict,
      eraserActive: this.tool === "erase",
    });
  }

  penDown(client: Vec): void {
    if (this.tool === "erase") this.eraseAt(this.toWorld(client));
    else this.ink.penDown(this.toWorld(client));
  }

  penMove(client: Vec): void {
    if (this.tool === "erase") this.eraseAt(this.toWorld(client));
    else this.ink.penMove(this.toWorld(client));
  }

  penUp(): void {
    this.ink.penUp();
  }

  penCancel(): void {
    this.ink.penCancel();
  }

  tap(client: Vec): void {
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
    this.modules.sim.addDrawing(drawing);
    this.modules.autopilot.invalidate();
    this.ledger.add(drawing);
    this.modules.store.saveDrawing(this.board.id, { drawing, ruling: null });
    void this.offerGuesses(drawing);
  }

  onReject(reason: PlacementRejection): void {
    this.remark(REJECTION_LINES[reason]);
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

  onAutopilotToggled(enabled: boolean): void {
    this.selfDriving = enabled;
    this.wasStuck = false;
    this.modules.autopilot.reset();
    this.hud.setAutopilot(enabled);
    this.modules.onSelfDrivingChanged?.(enabled);
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

  onClearBoard(): void {
    this.modules.store.clear(this.board.id);
    void this.open(this.board.id, { remember: false });
  }

  private async open(boardId: string, { remember = true } = {}): Promise<void> {
    const { sim, cat, renderer, store, boardFor, onBoardOpened } = this.modules;
    this.epoch += 1;
    const epoch = this.epoch;
    this.board = boardFor(boardId);

    sim.loadBoard(this.board);
    this.modules.autopilot.reset();
    this.wasStuck = false;
    renderer.setBoard(this.board);
    this.ink.reset(Number.POSITIVE_INFINITY);
    this.ledger.clear();
    this.notes.clear();
    this.rules.replaceAll([]);
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

    if (!remember) return;
    const snapshot = await store.load(boardId);
    if (epoch === this.epoch) this.restore(snapshot);
  }

  private restore({ drawings, notes, rules }: BoardSnapshot): void {
    const { sim } = this.modules;
    for (const { drawing, ruling } of drawings) {
      sim.addDrawing(drawing);
      this.ledger.add(drawing);
      if (ruling === null) continue;
      sim.applyRuling(drawing.id, ruling);
      this.ledger.awaken(drawing.id, ruling, this.nowMs - ALREADY_AWAKE_MS);
    }
    for (const note of notes) this.notes.restore(note, this.nowMs);
    this.rules.replaceAll(rules);
    for (const rule of rules) this.writeGloss(rule);
    this.applyLaws({ silently: true });
    this.modules.autopilot.invalidate();
  }

  /** Held keys drive her; otherwise she drives herself, unless the player switched that off. */
  private chooseIntent(): WalkIntent {
    const { autopilot } = this.modules;
    const steered = this.manualIntent.x !== 0 || this.manualIntent.y !== 0;
    if (steered || !this.selfDriving) return this.manualIntent;
    const intent = autopilot.drive(this.scene());
    const { stuck } = autopilot.status;
    if (stuck && !this.wasStuck) this.remark(STUCK_LINE);
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
      keyTaken: world.keyTaken,
      doorOpen: world.doorOpen,
      walkSpeed: sim.walkSpeed(),
      canFly: sim.canFly(),
      bounceArc: (strength) => sim.bounceArc(strength),
      jumpArc: sim.jumpArc(),
    };
  }

  private async listBoards(epoch: number): Promise<void> {
    const remembered = await this.modules.store.listBoards();
    if (epoch !== this.epoch) return;
    const demo = this.modules.boardFor("wonderland");
    const ids = new Set([demo.id, this.board.id, ...remembered.map((summary) => summary.id)]);
    this.hud.setBoards(
      [...ids].map((id) => ({ id, title: this.modules.boardFor(id).title })),
      this.board.id,
    );
  }

  private handle(event: SimEvent): void {
    switch (event.type) {
      case "goal-reached":
        this.remark(GOAL_LINE, HINT_LIFETIME_MS);
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
      { lifetimeMs: HINT_LIFETIME_MS },
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

  private async offerGuesses(drawing: Drawing): Promise<void> {
    const epoch = this.epoch;
    const guesses = await this.modules.cat.guess(drawing);
    if (epoch !== this.epoch || this.ledger.get(drawing.id)?.ruling !== null) return;

    const bounds = boundsOf(drawing.strokes.flat());
    const corner = { x: bounds.x + bounds.width + GUESS_OFFSET.x, y: bounds.y + GUESS_OFFSET.y };
    const anchor: NoteAnchor = { type: "drawing", id: drawing.id };
    if (!this.hasAskedWhatItIs) {
      this.hasAskedWhatItIs = true;
      this.kamiWrites(
        this.modules.cat.askWhatItIs(),
        { x: corner.x, y: corner.y - GUESS_OFFSET.line },
        { lifetimeMs: GUESS_LIFETIME_MS, anchor, drift: "down" },
      );
    }
    guesses.forEach((name, index) => {
      this.kamiWrites(
        `${name}?`,
        { x: corner.x, y: corner.y + index * GUESS_OFFSET.line },
        {
          lifetimeMs: GUESS_LIFETIME_MS,
          anchor,
          action: { type: "name-drawing", drawingId: drawing.id, name },
          drift: "down",
        },
      );
    });
  }

  private perform(action: NoteAction, offered: Note): void {
    const label = this.playerWrites(action.name, offered.position);
    void this.nameDrawing(action.drawingId, action.name, label);
  }

  private async promptAt(client: Vec, world: Vec): Promise<void> {
    const epoch = this.epoch;
    const text = await this.hud.promptText(client);
    if (text !== null && epoch === this.epoch) await this.interpret(text, world);
  }

  /**
   * The one funnel: a request for help, a law of physics, a name for a drawing, or a remark.
   * Whatever is instant is tried first; the model is only asked about what nothing else understood.
   */
  private async interpret(text: string, position: Vec): Promise<void> {
    if (isHelpRequest(text)) {
      this.kamiWrites(this.modules.cat.hint().line, position, { lifetimeMs: HINT_LIFETIME_MS });
      return;
    }
    const note = this.playerWrites(text, position);
    const stillHere = this.witness(note.id);

    const law = await this.modules.compiler.compile(text);
    if (!stillHere()) return;
    if (law !== null) {
      this.enact(this.ruleFrom(law, note));
      return;
    }

    const subject = this.drawingNear(note.id);
    const ruling = subject === null ? null : await this.modules.cat.name(text, subject.drawing);
    if (!stillHere()) return;
    if (subject !== null && ruling !== null && ruling.nature !== "ink") {
      this.name(subject.drawing.id, ruling, note);
      return;
    }

    const thought = await this.ponder(text, note.id);
    if (!stillHere()) return;
    if (thought !== null) this.enact(this.ruleFrom(thought, note));
    else if (subject !== null && ruling !== null) this.name(subject.drawing.id, ruling, note);
    else this.shrug(note.id);
  }

  /** True until the board changes or the note is erased — checked after every await. */
  private witness(noteId: NoteId): () => boolean {
    const epoch = this.epoch;
    return () => epoch === this.epoch && this.notes.get(noteId) !== null;
  }

  private async ponder(text: string, noteId: NoteId): Promise<CompiledRule | null> {
    const under = this.notes.below(noteId);
    const pondering: NoteAnchor = { type: "note", id: noteId };
    if (under !== null)
      this.kamiWrites(PONDERING_LINE, under, { anchor: pondering, drift: "down" });
    const thought = await this.modules.thinker.compile(text);
    this.notes.removeAnchoredTo(pondering);
    return thought;
  }

  private ruleFrom(compiled: CompiledRule, note: Note): Rule {
    return {
      ...compiled,
      id: this.ids.next<RuleId>("rule"),
      sourceText: note.text,
      noteId: note.id,
      position: note.position,
      createdAt: Date.now(),
    };
  }

  private enact(rule: Rule): void {
    this.rules.enact(rule);
    this.applyLaws({ silently: false });
    this.modules.autopilot.invalidate();
    this.modules.store.saveRule(this.board.id, rule);
    this.understood(rule.noteId);
    this.writeGloss(rule);
    this.stuck.progress(this.nowMs);
  }

  private async nameDrawing(id: DrawingId, name: string, label: Note): Promise<void> {
    const epoch = this.epoch;
    const record = this.ledger.get(id);
    if (record === null) return;
    const ruling = await this.modules.cat.name(name, record.drawing);
    if (epoch === this.epoch) this.name(id, ruling, label);
  }

  private name(id: DrawingId, ruling: Ruling, label: Note): void {
    const awake = this.ledger.awaken(id, ruling, this.nowMs);
    if (awake === null) return;

    this.modules.sim.applyRuling(id, ruling);
    this.modules.autopilot.invalidate();
    this.modules.store.saveDrawing(this.board.id, { drawing: awake.drawing, ruling });
    this.forget(this.notes.removeAnchoredTo({ type: "drawing", id }));
    this.notes.attach(label.id, { type: "drawing", id });
    if (ruling.nature !== "ink") this.understood(label.id);
    const under = this.notes.below(label.id);
    if (under !== null) {
      this.kamiWrites(ruling.line, under, { lifetimeMs: REMARK_LIFETIME_MS, drift: "down" });
    }
    this.stuck.progress(this.nowMs);
  }

  private shrug(noteId: NoteId): void {
    const under = this.notes.below(noteId);
    const line = SHRUGS[this.shrugs % SHRUGS.length];
    this.shrugs += 1;
    if (under !== null && line !== undefined) {
      this.kamiWrites(line, under, { lifetimeMs: REMARK_LIFETIME_MS, drift: "down" });
    }
  }

  private understood(noteId: NoteId): void {
    const note = this.notes.restyle(noteId, "understood");
    if (note !== null) this.modules.store.saveNote(this.board.id, note);
  }

  private writeGloss(rule: Rule): void {
    const under = this.notes.below(rule.noteId);
    if (under === null) return;
    this.kamiWrites(glossOf(rule.explanation), under, {
      anchor: { type: "note", id: rule.noteId },
      tone: "understood",
      drift: "down",
    });
  }

  private writeWordmark(): void {
    const at = {
      x: this.board.spawn.x + WORDMARK_OFFSET.x,
      y: this.board.spawn.y + WORDMARK_OFFSET.y,
    };
    this.kamiWrites(WORDMARK, at);
    this.kamiWrites(TAGLINE, { x: at.x, y: at.y + TAGLINE_DROP });
  }

  private playerWrites(text: string, position: Vec): Note {
    const note = this.notes.write({
      note: {
        id: this.ids.next<NoteId>("note"),
        author: "player",
        text,
        position,
        tone: "plain",
        createdAt: Date.now(),
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
    } = {},
  ): void {
    const { lifetimeMs, anchor, action, tone = "plain", drift = "up" } = options;
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
    this.notes.write({
      note,
      nowMs: this.nowMs,
      drift,
      ...(lifetimeMs === undefined ? {} : { lifetimeMs }),
      ...(anchor === undefined ? {} : { anchor }),
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
      { lifetimeMs },
    );
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
    if (repealed === null) return;
    this.modules.store.deleteRule(this.board.id, repealed.id);
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
    for (const note of removed.filter(isPlayers)) {
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
}

const IDLE_INTENT: WalkIntent = { x: 0, y: 0 };

const isPlayers = (note: Note): boolean => note.author === "player";

const currentBounds = (drawing: Drawing, { pose }: DrawingPose): Rect =>
  translateRect(boundsOf(drawing.strokes.flat()), {
    x: pose.position.x - pose.origin.x,
    y: pose.position.y - pose.origin.y,
  });
