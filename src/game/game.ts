import type { Scene } from "../autopilot/types";
import { arenaBoard, arenaHeight, endlessBoard, groundSolids } from "../board";
import type { BoardDefinition } from "../board/types";
import { boundsOf, type PenPoint, type Rect, type Stroke, type Vec } from "../core/geometry";
import { BULLET_TIME_SCALE, FIXED_STEP_MS } from "../core/world";
import type { Drawing, InkSession, InkSessionListener, PlacementRejection } from "../ink/types";
import { createDirector, EMBODIED_MODE, EMBODIED_MODE_ID } from "../modes";
import type { ModeDirector } from "../modes/types";
import type { Note, NoteAction, NoteId } from "../notes/types";
import type { BoardStore, FeedCursor } from "../persistence/types";
import type { PenReader } from "../reading/types";
import { motionAllowed } from "../render/animation/motion";
import type { RuleId } from "../rules/types";
import { ALICE_HERSELF, type SimEvent, type WalkIntent } from "../sim/types";
import { EditTrackingStore, type Ghost } from "../sync";
import { titleCardShownMs } from "../ui/titleCard";
import type { CanvasInputSink, Hud, HudHandlers, LawsPanelHandlers, Tool } from "../ui/types";
import { CameraRig, framingZoom } from "./cameraRig";
import { GameClock, type GameContext } from "./context";
import { Eraser } from "./eraser";
import { FixedStepLoop } from "./fixedStepLoop";
import { Handiwork, type Made } from "./handiwork";
import { HeldInkBook } from "./heldInk";
import { IdMint } from "./idMint";
import { InkLedger, storedOf } from "./inkLedger";
import { SOUL_WAITS_LINE } from "./kami/bossLines";
import { Conjurer } from "./kami/conjurer";
import { Funnel } from "./kami/funnel";
import { Glimpses } from "./kami/glimpses";
import { Lawgiver } from "./kami/lawgiver";
import {
  BLANK_BOARD_BRIEF,
  REJECTION_LINES,
  SUMIKUI_LORE_LINE_DELAY_MS,
  TAGLINE,
  TWIN_SELECTED_LINE,
  WORDMARK,
} from "./kami/lines";
import { Naming } from "./kami/naming";
import { CARD_READ_MS, introducesItself, Reactions, type Reopener } from "./kami/reactions";
import { Tidier } from "./kami/tidier";
import { HINT_LIFETIME_MS, Voice } from "./kami/voice";
import type { GameModules } from "./modules";
import { NoteBook } from "./noteBook";
import { isPlayers, NoteKeeping } from "./noteKeeping";
import { PageSync } from "./pageSync";
import { type Page, Party } from "./party";
import { Presence } from "./presence";
import { SteppedTurn } from "./steppedTurn";
import { StuckDetector } from "./stuckDetector";

const MAX_STEPS_PER_FRAME = 5;
const ERASER_TOLERANCE = 18;
const WORDMARK_OFFSET = { x: -70, y: -360 } as const;
const TAGLINE_DROP = 46;
const ARENA_LIFT = 18;

const writingOrigin = (strokes: readonly Stroke[]): Vec => {
  const { x, y } = boundsOf(strokes.flat());
  return { x, y };
};

/**
 * The game on one device: it wires input, the HUD and the laws panel to the sim and to Kami's
 * parts, opens boards, and draws every frame. `docs/architecture.md` → game/ describes the parts.
 */
export class Game implements CanvasInputSink, InkSessionListener, HudHandlers, LawsPanelHandlers {
  private readonly director: ModeDirector;
  private readonly clock = new GameClock();
  private readonly loop = new FixedStepLoop(FIXED_STEP_MS, MAX_STEPS_PER_FRAME);
  private readonly ledger = new InkLedger();
  private readonly camera = new CameraRig();
  private readonly turning = new SteppedTurn();
  private readonly stuck = new StuckDetector();
  private readonly ids = new IdMint();
  /** Settled ink the pen reader is still reading: weightless until it is known to be a drawing. */
  private readonly held = new HeldInkBook();
  private readonly handiwork = new Handiwork();
  private readonly knownBoards = new Set<string>();
  private readonly frameEvents: SimEvent[] = [];
  private readonly notes: NoteBook;
  private readonly party: Party;
  private readonly store: BoardStore;
  private readonly ink: InkSession;
  private readonly penReader: PenReader | null;
  private readonly hud: Hud;
  private readonly voice: Voice;
  private readonly keeping: NoteKeeping;
  private readonly tidier: Tidier;
  private readonly laws: Lawgiver;
  private readonly eraser: Eraser;
  private readonly reactions: Reactions;
  private readonly naming: Naming;
  private readonly conjurer: Conjurer;
  private readonly funnel: Funnel;
  private readonly glimpses: Glimpses;
  private readonly presence: Presence;
  private readonly sync: PageSync;

  private board: BoardDefinition;
  private loading = false;
  private retryingPersistence = false;
  private lastFrameMs = 0;
  private tool: Tool = "draw";
  private selfDriving: boolean;

  constructor(
    private readonly modules: GameModules,
    initialBoardId: string,
  ) {
    const { sim } = modules;
    this.director = createDirector(modules.mode ?? EMBODIED_MODE);
    this.board = this.sketch(initialBoardId);
    this.party = new Party(modules.autopilot);
    this.selfDriving = (modules.selfDriving ?? true) && this.walksHerself();
    this.notes = new NoteBook(modules.handwriting);
    const link = modules.link ?? null;
    this.store = link === null ? modules.store : new EditTrackingStore(modules.store, link);
    this.ink = modules.createInkSession(this);
    this.penReader = modules.penReader ?? null;
    this.hud = modules.createHud(this);

    const game = this;
    const context: GameContext = {
      modules,
      clock: this.clock,
      director: this.director,
      hud: this.hud,
      store: this.store,
      notes: this.notes,
      ledger: this.ledger,
      party: this.party,
      camera: this.camera,
      ids: this.ids,
      stuck: this.stuck,
      get board() {
        return game.board;
      },
    };
    this.voice = new Voice({
      notes: this.notes,
      camera: this.camera,
      ids: this.ids,
      clock: this.clock,
      hud: this.hud,
      renderer: modules.renderer,
      get board() {
        return game.board;
      },
      aliceBounds: () => sim.aliceBounds(this.party.selected),
      tearAt: () => sim.snapshot().tear?.at ?? null,
    });
    this.keeping = new NoteKeeping((id) => this.store.deleteNote(this.board.id, id));
    this.tidier = new Tidier(
      this.ledger,
      modules.finisher ?? null,
      this.clock,
      (record) => this.store.saveDrawing(this.board.id, storedOf(record)),
      modules.tidiness,
    );
    this.laws = new Lawgiver(context, this.voice, this.keeping, modules.createLawsPanel(this));
    this.eraser = new Eraser(context, this.keeping, this.laws);
    const reopener: Reopener = { open: (boardId, options) => void this.open(boardId, options) };
    this.reactions = new Reactions(context, this.voice, this.keeping, this.eraser, reopener);
    this.naming = new Naming(context, this.voice, this.keeping, this.tidier, (transition) =>
      this.reactions.embody(transition),
    );
    this.conjurer = new Conjurer(context, this.voice, this.naming, this.tidier);
    this.funnel = new Funnel(
      context,
      this.voice,
      this.laws,
      this.naming,
      this.conjurer,
      this.eraser,
      {
        askForHint: (at) => this.askForHint(at),
        playerWrites: (text, position) => this.playerWrites(text, position),
      },
    );
    this.glimpses = new Glimpses(modules.cat, this.ink, this.notes, this.voice, this.clock);
    this.presence = new Presence(
      this.director.mode.sharing === "live" ? link : null,
      this.hud,
      modules.shareLinkFor ?? null,
      this.clock,
    );
    this.sync = new PageSync(context, this.keeping, this.laws, this.presence, reopener);
    modules.summoner?.wake();
  }

  get currentTool(): Tool {
    return this.tool;
  }

  /** The other devices on this page, by their Alice. */
  get company(): readonly Ghost[] {
    return this.presence.company;
  }

  start(nowMs: number): Promise<void> {
    this.clock.nowMs = nowMs;
    this.lastFrameMs = nowMs;
    this.hud.setTool(this.tool);
    this.hud.offerAutopilot(this.walksHerself());
    this.hud.setMenu(this.director.mode.menu.kind);
    this.hud.setAutopilot(this.selfDriving);
    this.hud.setTidiness(this.tidier.tidiness);
    const opened = this.open(this.board.id);
    if (introducesItself(this.director)) this.hud.showTitleCard(this.director.mode.card);
    return opened;
  }

  frame(nowMs: number): void {
    const { sim, renderer } = this.modules;
    const { store } = this;
    this.hud.setPersistence(store.keepsBoards ? store.state(this.board.id) : null);
    const steps = this.loop.advance(nowMs - this.lastFrameMs);
    this.clock.nowMs = nowMs;
    this.lastFrameMs = nowMs;

    sim.setTimeScale(this.ink.isDrawing || this.held.isHolding ? BULLET_TIME_SCALE : 1);
    this.frameEvents.length = 0;
    for (let step = 0; !this.loading && step < steps; step++) {
      this.reactions.hear(this.party.drive(sim, () => this.page(), this.selfDriving, nowMs));
      for (const event of sim.step()) {
        this.frameEvents.push(event);
        this.reactions.witness(event);
      }
    }
    this.ink.update(nowMs, {
      noInkZones: this.board.noInkZones,
      solids: groundSolids(this.board),
      aliceBounds: this.inkKeepsOff(),
    });
    if (!this.ink.isDrawing) this.glimpses.forget();
    this.keeping.letGo(this.notes.expire(nowMs));
    this.voice.speakDue();
    this.tidier.frame();
    this.reactions.frame();
    const { selected } = this.party;
    this.camera.follow(
      sim.aliceBounds(selected),
      renderer.viewport(),
      sim.alices().flatMap((_, who) => (who === selected ? [] : [sim.aliceBounds(who)])),
    );
    this.camera.turnTo(this.turning.follow(sim.paperAngle(), nowMs, motionAllowed()));

    const world = sim.snapshot();
    this.presence.frame(this.board.id, world.alice, !this.loading);
    renderer.render({
      nowMs,
      camera: this.camera.camera,
      world,
      selectedAlice: selected,
      daylight: this.laws.physics.daylight,
      inks: this.ledger.views(world.drawings, nowMs),
      notes: this.notes.views(nowMs),
      activeStrokes: this.ink.activeStrokes,
      activeVerdict: this.ink.activeVerdict,
      heldInks: this.held.views(nowMs),
      eraserActive: this.tool === "erase",
      events: this.frameEvents,
      ghosts: this.presence.company,
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
    if (this.ink.isDrawing) void this.glimpses.look();
    this.penReader?.glimpse([...this.ink.activeStrokes]);
  }

  penCancel(): void {
    this.ink.penCancel();
  }

  onUndo(): void {
    this.undo();
  }

  /**
   * Takes back the last thing this player made: ink not yet landed stroke by stroke, else the
   * newest of their drawings or notes that still stands — ink hanging while it is read is let
   * go, anything on the page erased as the eraser would — its ink refunded.
   */
  undo(): void {
    if (this.loading || this.ink.retract()) return;
    const made = this.handiwork.takeLatest((entry) => this.stands(entry));
    if (made === null) return;
    if (made.kind === "note") {
      this.eraser.eraseNote(made.id);
      return;
    }
    this.ink.refund(made.cost);
    if (!this.held.retract(made.id)) this.eraser.discard(made.id);
  }

  tap(client: Vec): void {
    if (this.loading) return;
    const world = this.toWorld(client);
    const offered = this.notes.at(world, (note) => note.action !== undefined);
    if (offered?.action !== undefined) this.perform(offered.action, offered);
    else if (this.selectAliceAt(world)) return;
    else if (this.tool === "write") void this.promptAt(client, world);
  }

  panBy(deltaClient: Vec): void {
    this.camera.panBy(deltaClient);
  }

  zoomAt(client: Vec, factor: number): void {
    this.camera.zoomAt(client, factor, (point, camera) =>
      this.modules.renderer.toWorld(point, camera),
    );
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
    this.held.hold(drawing);
    this.handiwork.record({ kind: "drawing", id: drawing.id, cost: drawing.cost });
    void this.settleWords(drawing, reading);
  }

  onReject(reason: PlacementRejection, strokes: readonly Stroke[]): void {
    if (reason === "under-ground") return;
    if (this.penReader === null || reason === "too-detailed" || reason === "out-of-bounds") {
      this.voice.remark(REJECTION_LINES[reason]);
      return;
    }
    const known = this.penReader.recall(strokes);
    const reading = this.penReader.settle(strokes);
    if (typeof known === "string") {
      void this.funnel.interpret(known, writingOrigin(strokes));
      return;
    }
    this.voice.remark(REJECTION_LINES[reason]);
    if (known === undefined) void this.readWords(strokes, reading);
  }

  onWalkIntent(intent: WalkIntent): void {
    this.party.steer(intent);
    if (intent.x !== 0) this.camera.resumeFollowing();
  }

  onToolChanged(tool: Tool): void {
    this.tool = tool;
  }

  onZoom(factor: number): void {
    const { width, height } = this.modules.renderer.viewport();
    this.zoomAt({ x: width / 2, y: height / 2 }, factor);
  }

  onTidinessChanged(tidiness: number): void {
    const firmness = this.tidier.setTidiness(tidiness);
    this.modules.onTidinessChanged?.(firmness);
  }

  onAutopilotToggled(enabled: boolean): void {
    this.selfDriving = enabled && this.walksHerself();
    this.party.reset();
    this.hud.setAutopilot(this.selfDriving);
    this.modules.onSelfDrivingChanged?.(this.selfDriving);
  }

  onRecenter(): void {
    const alice = this.modules.sim.aliceBounds(this.party.selected);
    this.camera.frame(
      { x: alice.x + alice.width / 2, y: alice.y + alice.height },
      this.modules.renderer.viewport(),
    );
  }

  onResize(): void {
    const { sim, renderer } = this.modules;
    if (this.board.page !== "arena" || sim.snapshot().soul === null) return;
    this.board = this.arena(this.board.id);
    sim.loadBoard(this.board);
    if (this.director.state.kind === "spirit") sim.disembody();
    renderer.setBoard(this.board);
    this.pinArena();
  }

  onOpenBoard(boardId: string): void {
    void this.open(boardId);
  }

  onNewBoard(): void {
    void this.open(this.ids.next("sketch"));
  }

  onRepealLaw(id: RuleId): void {
    const law = this.laws.all.find((rule) => rule.id === id);
    if (law !== undefined) this.eraser.eraseNote(law.noteId);
  }

  onClearBoard(): void {
    this.store.clear(this.board.id);
    void this.open(this.board.id, { blank: true });
  }

  onRestartRun(): void {
    const { menu } = this.director.mode;
    if (menu.kind === "run") void this.open(menu.firstBoardId);
  }

  async onRetryPersistence(): Promise<void> {
    const { store } = this;
    const state = store.state(this.board.id);
    if (this.retryingPersistence || state.loading || state.saving) return;
    this.retryingPersistence = true;
    const current = this.clock.pageGuard();
    const boardId = this.board.id;
    try {
      await store.retry(boardId);
      if (!current()) return;
      if (state.errors.some(({ operation }) => operation === "load")) await this.open(boardId);
      else await this.listBoards();
    } finally {
      this.retryingPersistence = false;
    }
  }

  onAskForHint(): void {
    void this.askForHint();
  }

  /**
   * What writing *help* does, and what the CAT button does: on a page that helps on request Kami
   * reads what is around Alice and counsels; anywhere else the Cat climbs one rung of the room's
   * hint ladder. Asked from the HUD, with nowhere written, he answers above Alice as a remark.
   */
  async askForHint(at?: Vec): Promise<void> {
    if (this.loading) return;
    const around = this.director.mode.help === "on-request" ? this.scene() : null;
    if (around !== null) {
      await this.conjurer.counsel(around, at);
      return;
    }
    const { line } = this.modules.cat.hint();
    if (at === undefined) this.voice.remark(line, HINT_LIFETIME_MS);
    else this.voice.write(line, at, { lifetimeMs: HINT_LIFETIME_MS });
  }

  private playerWrites(text: string, position: Vec): Note {
    const note = this.notes.write({
      note: {
        id: this.ids.next<NoteId>("note"),
        author: "player",
        text,
        position,
        tone: "plain",
        createdAt: this.sync.stamp(),
        fleeting: false,
      },
      nowMs: this.clock.nowMs,
      drift: "down",
    });
    this.store.saveNote(this.board.id, note);
    this.keeping.answerFor(note.id);
    this.handiwork.record({ kind: "note", id: note.id });
    return note;
  }

  private walksHerself(): boolean {
    return this.director.mode.autopilot === "allowed";
  }

  private stands(made: Made): boolean {
    if (made.kind === "drawing") {
      return this.held.isReading(made.id) || this.ledger.get(made.id) !== null;
    }
    return (
      this.notes.get(made.id) !== null || this.laws.all.some(({ noteId }) => noteId === made.id)
    );
  }

  /** Tapping an Alice hands her the controls; among one she is already the one. */
  private selectAliceAt(world: Vec): boolean {
    const alices = this.modules.sim.alices();
    const who = this.party.aliceAt(world, alices);
    if (who === null || alices.length === 1) return false;
    if (who !== this.party.selected) {
      this.party.select(who);
      this.camera.resumeFollowing();
      this.voice.remark(TWIN_SELECTED_LINE(who));
    }
    return true;
  }

  /**
   * Opens a board: loads it, then follows it when shared. `blank` opens the same page again emptied,
   * as after a clear or a restart: nothing is loaded, and a shared page goes on being followed.
   */
  private async open(boardId: string, { blank = false } = {}): Promise<void> {
    const { sim, cat, renderer, onBoardOpened } = this.modules;
    const { store } = this;
    this.clock.turnPage();
    const current = this.clock.pageGuard();
    if (!blank) this.presence.leave();
    this.loading = !blank;
    this.board = this.sketch(boardId);

    sim.loadBoard(this.board);
    if (this.director.open(this.board).kind === "spirit") sim.disembody();
    this.reactions.reset();
    this.party.select(ALICE_HERSELF);
    this.party.reset();
    renderer.setBoard(this.board);
    this.ink.reset(Number.POSITIVE_INFINITY);
    this.penReader?.forget();
    this.held.clear();
    this.handiwork.clear();
    this.tidier.clear();
    this.ledger.clear();
    this.notes.clear();
    this.keeping.clear();
    this.glimpses.reset();
    this.laws.clear();
    this.naming.reset();
    this.stuck.reset(this.clock.nowMs);
    if (this.board.page === "arena") this.pinArena();
    else this.camera.frame(this.board.spawn, renderer.viewport());
    this.writeWordmark();
    const [firstZone] = this.board.zones;
    if (firstZone === undefined) cat.enterRoom(BLANK_BOARD_BRIEF);
    else this.reactions.introduce(firstZone);
    this.hud.showRoomCard(this.director.room?.card ?? null);
    this.speakOpeningLine();
    onBoardOpened?.(boardId);
    void this.listBoards();

    const { freshPage } = this.director.mode.opening;
    if (freshPage) store.clear(boardId);
    if (blank || freshPage) {
      if (!this.presence.following) this.sync.follow(boardId, null);
      this.loading = false;
      return;
    }
    const loadingNote = this.voice.write("Loading board…", this.board.spawn, { spoken: false });
    let cursor: FeedCursor | null = null;
    try {
      const snapshot = await store.load(boardId);
      if (current()) {
        this.sync.restore(snapshot);
        cursor = snapshot.cursor ?? null;
      }
    } catch {
      // The store exposes the failure; drawing remains available.
    } finally {
      if (current()) {
        this.notes.remove(loadingNote.id);
        this.loading = false;
        this.sync.follow(boardId, cursor);
      }
    }
  }

  private speakOpeningLine(): void {
    const { card } = this.director.mode;
    const introduced = introducesItself(this.director);
    const embodied = this.director.state.kind === "body";
    const line = embodied ? (introduced ? card.opening : null) : SOUL_WAITS_LINE;
    if (line === null) return;
    if (introduced)
      this.voice.recite([line], SUMIKUI_LORE_LINE_DELAY_MS, titleCardShownMs(card) + CARD_READ_MS);
    else this.voice.remark(line, HINT_LIFETIME_MS);
  }

  private page(): Page {
    const { sim } = this.modules;
    const world = sim.snapshot();
    return {
      board: this.board,
      inks: this.ledger.sceneInks(world.drawings),
      bites: world.bites,
      sumikui: world.sumikui,
      keyTaken: world.keyTaken,
      doorOpen: world.doorOpen,
      canFly: sim.canFly(),
      bounceArc: (strength) => sim.bounceArc(strength),
    };
  }

  /** The page as the selected Alice sees it: what Kami reads when asked for an idea. Null while nobody is on it. */
  private scene(): Scene | null {
    const { sim } = this.modules;
    const { selected } = this.party;
    const alices = sim.alices();
    const alice = alices[selected] ?? alices[ALICE_HERSELF];
    if (alice === undefined) return null;
    return {
      ...this.page(),
      alice,
      others: alices.filter((_, who) => who !== selected),
      walkSpeed: sim.walkSpeed(selected),
      jumpArc: sim.jumpArc(selected),
    };
  }

  private async listBoards(): Promise<void> {
    const current = this.clock.pageGuard();
    this.knownBoards.add(this.modules.boardFor("wonderland").id);
    this.knownBoards.add(this.board.id);
    this.showBoards();
    try {
      const remembered = await this.store.listBoards();
      if (!current()) return;
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

  /** Ink stays off Alice, except where she is made of it: a drawn body is drawn around, and mended by drawing on. */
  private inkKeepsOff(): Rect | null {
    return this.director.mode.opening.player === "spirit"
      ? null
      : this.modules.sim.aliceBounds(this.party.selected);
  }

  private land(drawing: Drawing): void {
    const { sim } = this.modules;
    if (this.director.state.kind === "body" && sim.graft(drawing.strokes)) return;
    sim.addDrawing(drawing);
    this.party.invalidate();
    this.ledger.add(drawing);
    this.handiwork.record({ kind: "drawing", id: drawing.id, cost: drawing.cost });
    this.store.saveDrawing(this.board.id, { drawing, ruling: null });
    void this.naming.offerGuesses(drawing);
  }

  /** Held ink is let down into the world if it was a drawing, or fades away as the words it was. */
  private async settleWords(drawing: Drawing, reading: Promise<string | null>): Promise<void> {
    const current = this.clock.pageGuard();
    const text = await reading;
    if (!current() || !this.held.isReading(drawing.id)) return;
    if (text === null) {
      this.held.release(drawing.id);
      this.land(drawing);
      return;
    }
    this.held.fade(drawing, this.clock.nowMs);
    this.ink.refund(drawing.cost);
    await this.funnel.interpret(text, writingOrigin(drawing.strokes));
  }

  private async readWords(
    strokes: readonly Stroke[],
    reading: Promise<string | null>,
  ): Promise<void> {
    const current = this.clock.pageGuard();
    const text = await reading;
    if (text !== null && current()) await this.funnel.interpret(text, writingOrigin(strokes));
  }

  private perform(action: NoteAction, offered: Note): void {
    const label = this.playerWrites(action.name, offered.position);
    if (action.ruling === undefined) void this.naming.nameAs(action.drawingId, action.name, label);
    else this.naming.name(action.drawingId, this.modules.cat.accept(action.ruling), label);
  }

  private async promptAt(client: Vec, world: Vec): Promise<void> {
    const current = this.clock.pageGuard();
    const text = await this.hud.promptText(client);
    if (text !== null && current()) await this.funnel.interpret(text, world);
  }

  /** The board under an id, read as the mode reads it: the room sketched there, or an endless page. */
  private sketch(boardId: string): BoardDefinition {
    switch (this.director.mode.page) {
      case "endless":
        return (this.modules.endlessPageFor ?? endlessBoard)(boardId);
      case "arena":
        return this.arena(boardId);
      default:
        return this.modules.boardFor(boardId);
    }
  }

  private arena(boardId: string): BoardDefinition {
    const viewport = this.modules.renderer.viewport();
    const zoom = framingZoom(viewport);
    return arenaBoard(boardId, { width: viewport.width / zoom, height: viewport.height / zoom });
  }

  private pinArena(): void {
    const zoom = framingZoom(this.modules.renderer.viewport());
    this.camera.pin({ x: 0, y: -arenaHeight(this.board) / 2 + ARENA_LIFT }, zoom);
  }

  private writeWordmark(): void {
    if (this.director.mode.id !== EMBODIED_MODE_ID) return;
    const at = {
      x: this.board.spawn.x + WORDMARK_OFFSET.x,
      y: this.board.spawn.y + WORDMARK_OFFSET.y,
    };
    this.voice.write(WORDMARK, at, { spoken: false });
    this.voice.write(TAGLINE, { x: at.x, y: at.y + TAGLINE_DROP }, { spoken: false });
  }

  private eraseAt(point: Vec): void {
    const { sim, findDrawingAt } = this.modules;
    const tolerance = ERASER_TOLERANCE / this.camera.camera.zoom;
    const id = findDrawingAt(point, this.ledger.posed(sim.snapshot().drawings), tolerance);
    if (id !== null) {
      this.ink.refund(this.handiwork.costOf(id));
      this.eraser.discard(id);
      return;
    }
    const written = this.notes.at(point, isPlayers);
    if (written !== null) this.eraser.eraseNote(written.id);
  }

  private toWorld(client: Vec): Vec {
    return this.modules.renderer.toWorld(client, this.camera.camera);
  }

  private penPointToWorld(client: PenPoint): PenPoint {
    const world = this.toWorld(client);
    return client.pressure === undefined ? world : { ...world, pressure: client.pressure };
  }
}
