import type { Scene } from "../autopilot/types";
import { arenaBoard, arenaHeight, endlessBoard, groundSolids } from "../board";
import type { BoardDefinition, Zone } from "../board/types";
import type { Nature } from "../cat/types";
import { canonicalOf } from "../core/canonical";
import { boundsOf, type PenPoint, type Rect, type Stroke, type Vec } from "../core/geometry";
import { penStrokesSchema } from "../core/input";
import { INPUT_LIMITS, isInputPoint, TEXT_LIMIT_MESSAGE } from "../core/inputLimits";
import { same } from "../core/same";
import { BULLET_TIME_SCALE, FIXED_STEP_MS } from "../core/world";
import { isIdeaRequest } from "../counsel";
import { isUnderGround } from "../ink/placement";
import type {
  Drawing,
  DrawingId,
  InkSession,
  InkSessionListener,
  PlacementRejection,
} from "../ink/types";
import { createDirector, EMBODIED_MODE, EMBODIED_MODE_ID } from "../modes";
import type { EmbodimentTransition, ModeDirector } from "../modes/types";
import type { Note, NoteAction, NoteId } from "../notes/types";
import type { BoardSnapshot, BoardStore, FeedCursor, StoredDrawing } from "../persistence/types";
import type { PenReader } from "../reading/types";
import type { Sighting } from "../recognition/types";
import { motionAllowed } from "../render/animation/motion";
import { destinationOf, placeCalled, referentOf, speaksOfReferent } from "../rules";
import type { CompileContext, Scene as Destination, Rule, RuleId } from "../rules/types";
import { BODY_TUNING } from "../sim/boss/tuning";
import { ALICE_HERSELF, type SimEvent, type WalkIntent } from "../sim/types";
import { type BoardChange, EditTrackingStore, type Ghost } from "../sync";
import { roomCardShownMs } from "../ui/roomCard";
import { titleCardShownMs } from "../ui/titleCard";
import type { CanvasInputSink, Hud, HudHandlers, LawsPanelHandlers, Tool } from "../ui/types";
import {
  HEART_SWALLOWED_LINE,
  INCARNATED_LINE,
  INCARNATED_PARTS_LINE,
  PART_RESTORED_LINE,
  SERVANT_CAME_LINE,
  SERVANT_PERISHED_LINE,
  SERVANT_STRUCK_LINE,
  SERVANTS_CAME_LINE,
  SHIELDED_LINE,
  SNIP_MISSED_LINE,
  SNIPPED_LINE,
  SOUL_WAITS_LINE,
  TEAR_CLOSED_LINE,
  TEAR_LINE_DELAY_MS,
  TEAR_OPENS_LINES,
  UNMADE_LINE,
} from "./bossLines";
import { CameraRig, framingZoom } from "./cameraRig";
import { Conjurer } from "./conjurer";
import { GameClock, type GameContext } from "./context";
import { FixedStepLoop } from "./fixedStepLoop";
import { Handiwork, type Made } from "./handiwork";
import { HeldInkBook } from "./heldInk";
import { IdMint } from "./idMint";
import { InkLedger, type InkRecord, storedOf } from "./inkLedger";
import { bodyCluster, nearestInk } from "./inkNearby";
import { Lawgiver } from "./lawgiver";
import { LineCycles } from "./lineCycles";
import {
  ALICE_CORNERED_LINE,
  ALICE_FLEES_LINES,
  aboutAlice,
  BLANK_BOARD_BRIEF,
  DEVOURED_ROOM_RESTARTS_LINE,
  DOOR_OPENED_LINE,
  FELL_OFF_PAGE_LINE,
  GOAL_LINE,
  GROW_BLOCKED_LINE,
  IN_THE_DARK_LINE,
  isHelpRequest,
  KEY_TAKEN_LINE,
  NAME_IT_FIRST_LINE,
  NOWHERE_LINE,
  OFFER_HELP_HINT,
  PERISHED_LINES,
  PORTAL_LONELY_LINE,
  REJECTION_LINES,
  SHRUGS,
  STUCK_LINE,
  SUMIKUI_ALICE_DEVOURED_LINES,
  SUMIKUI_DEVOURED_LINES,
  SUMIKUI_LORE_LINE_DELAY_MS,
  SUMIKUI_PAPER_BITTEN_LINES,
  SUMIKUI_WOKE_LINE,
  sceneGlossOf,
  TAGLINE,
  TWIN_GOAL_LINE,
  TWIN_SELECTED_LINE,
  WARPED_LINES,
  WORDMARK,
} from "./lines";
import type { GameModules } from "./modules";
import { guessCornerOf, NAMING_REACH, Naming, NOTE_LINGER_MS } from "./naming";
import { NoteBook } from "./noteBook";
import { isPlayers, NoteKeeping } from "./noteKeeping";
import { type Page, Party } from "./party";
import { Presence } from "./presence";
import { SteppedTurn } from "./steppedTurn";
import { StuckDetector } from "./stuckDetector";
import { Tidier } from "./tidier";
import { ABOVE_ALICE, HINT_LIFETIME_MS, Voice } from "./voice";

const MAX_STEPS_PER_FRAME = 5;
const ERASER_TOLERANCE = 18;
const GLIMPSE_LIFETIME_MS = 8_000;
/**
 * Another device's note leaves when its writer lets it go. One whose writer vanished first leaves
 * this screen after this long, without being deleted: it is not this device's to delete.
 */
const PEER_NOTE_LIFETIME_MS = 120_000;
/** A note on a shared page this old has outlived any writer's answer: whoever opens the page tidies it. */
const ORPHANED_NOTE_AGE_MS = 10 * 60_000;
/** Long enough to read the closing line where she stands before the next room opens over it. */
const NEXT_ROOM_DELAY_MS = 4_000;
/** Long enough to read that the heart was taken before the room opens over. */
const RESTART_AFTER_MS = 2_800;
/** A heatwave takes drawings by the handful; Kami mourns them once in a while, not one by one. */
const PERISHED_REMARK_GAP_MS = 8_000;
const WORDMARK_OFFSET = { x: -70, y: -360 } as const;
const TAGLINE_DROP = 46;
const ALREADY_AWAKE_MS = 10_000;
const CARD_READ_MS = 600;
const ROOM_RESTARTS_LINES: Readonly<Record<"fell" | "devoured" | "swallowed", string>> = {
  fell: UNMADE_LINE,
  devoured: DEVOURED_ROOM_RESTARTS_LINE,
  swallowed: HEART_SWALLOWED_LINE,
};

export class Game implements CanvasInputSink, InkSessionListener, HudHandlers, LawsPanelHandlers {
  private readonly director: ModeDirector;
  private readonly clock = new GameClock();
  private readonly loop = new FixedStepLoop(FIXED_STEP_MS, MAX_STEPS_PER_FRAME);
  private readonly ledger = new InkLedger();
  private readonly camera = new CameraRig();
  private readonly turning = new SteppedTurn();
  private readonly stuck = new StuckDetector();
  private readonly ids = new IdMint();
  private readonly cycles = new LineCycles();
  /** Settled ink the pen reader is still reading: weightless until it is known to be a drawing. */
  private readonly held = new HeldInkBook();
  private readonly handiwork = new Handiwork();
  private readonly introduced = new Set<string>();
  private readonly knownBoards = new Set<string>();
  private readonly frameEvents: SimEvent[] = [];
  private readonly notes: NoteBook;
  private readonly party: Party;
  private readonly store: BoardStore;
  private readonly ink: InkSession;
  private readonly penReader: PenReader | null;
  private readonly hud: Hud;
  private readonly context: GameContext;
  private readonly voice: Voice;
  private readonly keeping: NoteKeeping;
  private readonly tidier: Tidier;
  private readonly laws: Lawgiver;
  private readonly naming: Naming;
  private readonly conjurer: Conjurer;
  private readonly presence: Presence;

  private board: BoardDefinition;
  private loading = false;
  private retryingPersistence = false;
  private lastSubmittedAt = 0;
  private lastFrameMs = 0;
  private tool: Tool = "draw";
  private selfDriving: boolean;
  private lastPerishedRemarkMs = Number.NEGATIVE_INFINITY;
  private nextRoom: { readonly boardId: string; readonly atMs: number } | null = null;
  private restartDueAtMs: number | null = null;
  private glimpsing = false;
  private glimpseAgain = false;
  private glimpse: { readonly noteId: NoteId; readonly word: string } | null = null;

  constructor(
    private readonly modules: GameModules,
    initialBoardId: string,
  ) {
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
    this.presence = new Presence(
      this.director.mode.sharing === "live" ? link : null,
      this.hud,
      modules.shareLinkFor ?? null,
      this.clock,
    );
    const game = this;
    this.context = {
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
      aliceBounds: () => modules.sim.aliceBounds(this.party.selected),
      tearAt: () => modules.sim.snapshot().tear?.at ?? null,
    });
    this.keeping = new NoteKeeping((id) => this.store.deleteNote(this.board.id, id));
    this.tidier = new Tidier(
      this.ledger,
      modules.finisher ?? null,
      this.clock,
      (record) => this.store.saveDrawing(this.board.id, storedOf(record)),
      modules.tidiness,
    );
    this.laws = new Lawgiver(this.context, this.voice, this.keeping, modules.createLawsPanel(this));
    this.naming = new Naming(this.context, this.voice, this.keeping, this.tidier, (transition) =>
      this.embody(transition),
    );
    this.conjurer = new Conjurer(this.context, this.voice, this.naming, this.tidier);
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
    if (this.introducesItself) this.hud.showTitleCard(this.director.mode.card);
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
      this.chooseIntents();
      for (const event of sim.step()) {
        this.frameEvents.push(event);
        this.handle(event);
      }
    }
    this.ink.update(nowMs, {
      noInkZones: this.board.noInkZones,
      solids: groundSolids(this.board),
      aliceBounds: this.inkKeepsOff(),
    });
    if (!this.ink.isDrawing) this.forgetGlimpse();
    this.keeping.letGo(this.notes.expire(nowMs));
    this.voice.speakDue();
    this.tidier.frame();
    if (this.restartDueAtMs !== null && nowMs >= this.restartDueAtMs) this.restart();
    if (this.embodied && this.director.mode.help === "offered" && this.stuck.isStuck(nowMs))
      this.offerHelp();
    if (this.nextRoom !== null && nowMs >= this.nextRoom.atMs)
      void this.open(this.nextRoom.boardId);
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
    if (this.ink.isDrawing) void this.glimpseInk();
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
      this.eraseNote(made.id);
      return;
    }
    this.ink.refund(made.cost);
    if (!this.held.retract(made.id)) this.discard(made.id);
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
      void this.interpret(known, writingOrigin(strokes));
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
    const feet = this.modules.sim.aliceBounds(this.party.selected);
    this.camera.frame(
      { x: feet.x + feet.width / 2, y: feet.y + feet.height },
      this.modules.renderer.viewport(),
    );
  }

  onResize(): void {
    const { sim, renderer } = this.modules;
    if (this.board.page !== "arena" || sim.snapshot().soul === null) return;
    const viewport = renderer.viewport();
    this.board = this.arena(this.board.id);
    sim.loadBoard(this.board);
    if (this.director.state.kind === "spirit") sim.disembody();
    renderer.setBoard(this.board);
    this.pinArena(viewport);
  }

  onOpenBoard(boardId: string): void {
    void this.open(boardId);
  }

  onNewBoard(): void {
    void this.open(this.ids.next("sketch"));
  }

  onRepealLaw(id: RuleId): void {
    const law = this.laws.all.find((rule) => rule.id === id);
    if (law !== undefined) this.eraseNote(law.noteId);
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
    const around = this.counselsOnRequest ? this.scene() : null;
    if (around !== null) {
      await this.conjurer.counsel(around, at);
      return;
    }
    const { line } = this.modules.cat.hint();
    if (at === undefined) this.voice.remark(line, HINT_LIFETIME_MS);
    else this.voice.write(line, at, { lifetimeMs: HINT_LIFETIME_MS });
  }

  /** A mode other than today's play introduces itself, unless the room it stages opens on a card of its own. */
  private get introducesItself(): boolean {
    return this.director.mode.id !== EMBODIED_MODE_ID && this.director.room === null;
  }

  private get embodied(): boolean {
    return this.director.state.kind === "body";
  }

  private get counselsOnRequest(): boolean {
    return this.director.mode.help === "on-request";
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
    this.nextRoom = null;

    sim.loadBoard(this.board);
    if (this.director.open(this.board).kind === "spirit") sim.disembody();
    this.restartDueAtMs = null;
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
    this.glimpse = null;
    this.laws.clear();
    this.introduced.clear();
    this.naming.reset();
    this.stuck.reset(this.clock.nowMs);
    if (this.board.page === "arena") this.pinArena(renderer.viewport());
    else this.camera.frame(this.board.spawn, renderer.viewport());
    this.writeWordmark();
    const [firstZone] = this.board.zones;
    if (firstZone === undefined) cat.enterRoom(BLANK_BOARD_BRIEF);
    else this.introduce(firstZone);
    this.hud.showRoomCard(this.director.room?.card ?? null);
    this.speakOpeningLine();
    onBoardOpened?.(boardId);
    void this.listBoards();

    const { freshPage } = this.director.mode.opening;
    if (freshPage) store.clear(boardId);
    if (blank || freshPage) {
      if (!this.presence.following) this.follow(boardId, null);
      this.loading = false;
      return;
    }
    const loadingNote = this.voice.write("Loading board…", this.board.spawn, { spoken: false });
    let cursor: FeedCursor | null = null;
    try {
      const snapshot = await store.load(boardId);
      if (current()) {
        this.restore(snapshot);
        cursor = snapshot.cursor ?? null;
      }
    } catch {
      // The store exposes the failure; drawing remains available.
    } finally {
      if (current()) {
        this.notes.remove(loadingNote.id);
        this.loading = false;
        this.follow(boardId, cursor);
      }
    }
  }

  private speakOpeningLine(): void {
    const { card } = this.director.mode;
    const line = this.embodied ? (this.introducesItself ? card.opening : null) : SOUL_WAITS_LINE;
    if (line === null) return;
    if (this.introducesItself)
      this.voice.recite([line], SUMIKUI_LORE_LINE_DELAY_MS, titleCardShownMs(card) + CARD_READ_MS);
    else this.voice.remark(line, HINT_LIFETIME_MS);
  }

  private restore({ drawings, notes, rules }: BoardSnapshot): void {
    for (const stored of drawings) this.placeDrawing(stored);
    for (const note of notes) this.placeNote(note, "restored");
    this.laws.restore(rules);
    this.party.invalidate();
  }

  private follow(boardId: string, since: FeedCursor | null): void {
    this.presence.follow(boardId, since, {
      changed: (change) => this.receive(change),
      resync: () => void this.catchUp(boardId),
    });
  }

  /**
   * After a resync: the page as the server has it now is folded into the board without opening it
   * afresh, so Alice, the stroke under the pen and the undo history stay where they are.
   */
  private async catchUp(boardId: string): Promise<void> {
    const current = this.clock.pageGuard();
    let snapshot: BoardSnapshot | null = null;
    try {
      snapshot = await this.store.load(boardId);
    } catch {
      // The store exposes the failure; the page is followed from where the feed stands now.
    }
    if (!current()) return;
    if (snapshot !== null) this.reconcile(snapshot);
    this.follow(boardId, snapshot?.cursor ?? null);
  }

  /** Takes off the board what the page no longer holds, then places what it does. */
  private reconcile({ drawings, notes, rules }: BoardSnapshot): void {
    const drawingIds = new Set<DrawingId>(drawings.map(({ drawing }) => drawing.id));
    const noteIds = new Set(notes.map(({ id }) => id));
    const ruleIds = new Set(rules.map(({ id }) => id));
    for (const id of this.ledger.ids()) if (!drawingIds.has(id)) this.dropDrawing(id);
    for (const note of this.notes.all)
      if (this.keeping.isStored(note) && !noteIds.has(note.id)) this.dropNote(note.id);
    for (const rule of this.laws.all) if (!ruleIds.has(rule.id)) this.laws.drop(rule.id);
    for (const stored of drawings) this.placeDrawing(stored);
    for (const note of notes) this.placeNote(note, "received");
    for (const rule of rules) this.placeLaw(rule);
  }

  /** A change another device made (or this one's, echoed back): it lands the way a local one does. */
  private receive(change: BoardChange): void {
    switch (change.type) {
      case "put":
        switch (change.kind) {
          case "drawings":
            this.placeDrawing(change.entity);
            return;
          case "notes":
            this.placeNote(change.entity, "received");
            return;
          case "rules":
            this.placeLaw(change.entity);
            return;
        }
        return;
      case "delete":
        switch (change.kind) {
          case "drawings":
            this.dropDrawing(change.id);
            return;
          case "notes":
            this.dropNote(change.id);
            return;
          case "rules":
            this.laws.drop(change.id);
            return;
        }
        return;
      case "clear":
        void this.open(this.board.id, { blank: true });
        return;
    }
  }

  /** A stored drawing takes its place on the page; one already there is left alone or retraced. */
  private placeDrawing({ drawing, ruling, provenance = "drawn" }: StoredDrawing): void {
    const { sim } = this.modules;
    const { nowMs } = this.clock;
    const known = this.ledger.get(drawing.id);
    if (known !== null) {
      if (!same(canonicalOf(penStrokesSchema, known.drawing.strokes), drawing.strokes)) {
        this.ledger.retrace(drawing.id, drawing.strokes, nowMs);
      }
      if (ruling !== null && !same(known.ruling, ruling)) {
        sim.applyRuling(drawing.id, ruling);
        this.ledger.awaken(drawing.id, ruling, nowMs);
      }
      return;
    }
    sim.addDrawing(drawing, provenance);
    this.ledger.add(drawing, provenance);
    if (ruling !== null) {
      sim.applyRuling(drawing.id, ruling);
      this.ledger.awaken(drawing.id, ruling, nowMs - ALREADY_AWAKE_MS);
    }
    this.party.invalidate();
  }

  /**
   * A saved note takes its place where it was written. A note from a previous session fades after
   * `NOTE_LINGER_MS`, and the page forgets it with it, unless another device may still be answering
   * it; a note arriving from another device stays until its writer lets it go.
   */
  private placeNote(note: Note, from: "restored" | "received"): void {
    this.lastSubmittedAt = Math.max(this.lastSubmittedAt, note.createdAt);
    if (same(this.notes.get(note.id), note)) return;
    const restored = from === "restored";
    this.notes.restore(note, this.clock.nowMs, restored ? NOTE_LINGER_MS : PEER_NOTE_LIFETIME_MS);
    this.keeping.placed(
      note,
      restored && (!this.presence.live || Date.now() - note.createdAt > ORPHANED_NOTE_AGE_MS),
    );
  }

  private placeLaw(rule: Rule): void {
    this.lastSubmittedAt = Math.max(this.lastSubmittedAt, rule.createdAt);
    this.laws.place(rule);
  }

  private dropDrawing(id: DrawingId): void {
    if (this.ledger.remove(id) === null) return;
    this.modules.sim.removeDrawing(id);
    this.party.invalidate();
    this.keeping.dropped(this.notes.removeAnchoredTo({ type: "drawing", id }));
  }

  private dropNote(id: NoteId): void {
    this.keeping.dropped(this.notes.remove(id));
  }

  /** Held keys drive the selected Alice; every other one drives herself, unless the player switched that off. */
  private chooseIntents(): void {
    const { sim } = this.modules;
    const news = this.party.drive(sim, () => this.page(), this.selfDriving, this.clock.nowMs);
    for (const { who, kind } of news) {
      switch (kind) {
        case "flees":
          this.voice.remark(aboutAlice(who, this.cycles.next(ALICE_FLEES_LINES)));
          break;
        case "cornered":
          this.voice.remark(aboutAlice(who, ALICE_CORNERED_LINE));
          break;
        case "stuck":
          if (who === this.party.selected) this.voice.remark(STUCK_LINE);
          break;
      }
    }
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

  private handle(event: SimEvent): void {
    if (this.director.won(event)) this.celebrate(event);
    const transitions = this.director.witness(event);
    for (const transition of transitions) this.embody(transition);
    const unmade = transitions.some((transition) => transition.kind === "unmade");
    const { voice, cycles, party, stuck } = this;
    const { nowMs } = this.clock;
    switch (event.type) {
      case "fell":
        if (event.who === party.selected) {
          stuck.fell();
          if (this.director.mode.page === "endless")
            voice.remark(FELL_OFF_PAGE_LINE, HINT_LIFETIME_MS);
        }
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
        stuck.progress(nowMs);
        return;
      case "consumed":
        this.discard(event.drawingId);
        stuck.progress(nowMs);
        return;
      case "perished":
        this.discard(event.drawingId);
        party.invalidate();
        this.mourn(event.nature);
        return;
      case "grow-blocked":
        voice.remark(GROW_BLOCKED_LINE);
        return;
      case "sumikui-woke":
        voice.remark(SUMIKUI_WOKE_LINE, HINT_LIFETIME_MS);
        return;
      case "devoured":
        this.discard(event.drawingId);
        voice.remark(cycles.next(SUMIKUI_DEVOURED_LINES));
        return;
      case "paper-bitten":
        party.invalidate();
        voice.remark(cycles.next(SUMIKUI_PAPER_BITTEN_LINES));
        return;
      case "paper-healed":
        party.invalidate();
        return;
      case "alice-devoured":
        party.invalidate();
        if (!unmade)
          voice.remark(
            aboutAlice(event.who, cycles.next(SUMIKUI_ALICE_DEVOURED_LINES)),
            HINT_LIFETIME_MS,
          );
        return;
      case "warped":
        party.invalidate();
        if (event.who === party.selected) stuck.progress(nowMs);
        voice.remark(cycles.next(WARPED_LINES));
        return;
      case "portal-lonely":
        voice.remark(PORTAL_LONELY_LINE);
        return;
      case "in-the-dark":
        voice.remark(IN_THE_DARK_LINE, HINT_LIFETIME_MS);
        return;
      case "servant-came":
        voice.remark(SERVANT_CAME_LINE, HINT_LIFETIME_MS);
        return;
      case "servants-came":
        voice.remark(SERVANTS_CAME_LINE(event.lessers), HINT_LIFETIME_MS);
        return;
      case "snipped":
        voice.remark(SNIPPED_LINE(event.part, event.lost));
        return;
      case "snip-missed":
        voice.remark(SNIP_MISSED_LINE);
        return;
      case "shielded":
        this.discard(event.drawingId);
        voice.remark(SHIELDED_LINE);
        return;
      case "servant-struck":
        voice.remark(SERVANT_STRUCK_LINE(event.rank));
        return;
      case "servant-perished":
        voice.remark(SERVANT_PERISHED_LINE(event.rank), HINT_LIFETIME_MS);
        return;
      case "part-restored":
        voice.remark(PART_RESTORED_LINE(event.parts));
        return;
      case "goal-reached":
      case "tear-closed":
      case "heart-swallowed":
        return;
    }
  }

  /** The room is won: Kami's closing line, and in a run of rooms the next one opens once it has been read. */
  private celebrate(event: SimEvent): void {
    const { room, mode } = this.director;
    if (room !== null) {
      this.voice.remark(room.closing, HINT_LIFETIME_MS);
      if (room.next === null) this.showWonCard();
      else this.nextRoom = { boardId: room.next, atMs: this.clock.nowMs + NEXT_ROOM_DELAY_MS };
      return;
    }
    if (event.type === "tear-closed" && mode.win.kind === "defeat-foe") this.showWonCard();
    this.voice.remark(this.goalLine(event), HINT_LIFETIME_MS);
  }

  private goalLine(event: SimEvent): string {
    if (event.type === "tear-closed") return TEAR_CLOSED_LINE;
    if (event.type !== "goal-reached" || this.modules.sim.alices().length === 1) return GOAL_LINE;
    return TWIN_GOAL_LINE(event.who);
  }

  private showWonCard(): void {
    const { card } = this.director.mode;
    if (card.won !== undefined) this.hud.showTitleCard({ ...card, ...card.won });
  }

  /** Enacts what the director ruled about her body: a drawing becomes her, the tear opens, or she is unmade. */
  private embody(transition: EmbodimentTransition): void {
    switch (transition.kind) {
      case "incarnated":
        if (transition.by !== "spawn") this.incarnate(transition.drawingId, transition.name);
        return;
      case "tear-opens":
        this.modules.sim.openTear();
        this.voice.recite(TEAR_OPENS_LINES, TEAR_LINE_DELAY_MS);
        return;
      case "unmade":
        this.lose(transition.cause);
        return;
    }
  }

  /** The drawing, and the unnamed ink joined to it around the heart, becomes her body. */
  private incarnate(drawingId: DrawingId, name: string): void {
    const { sim } = this.modules;
    const { soul, drawings } = sim.snapshot();
    if (soul === null) return;
    const cluster = bodyCluster(drawingId, soul.at, drawings, this.ledger, BODY_TUNING.graftReach);
    if (cluster === null || !sim.incarnate(drawingId, name, cluster.strokes)) return;
    this.ledger.remove(drawingId);
    this.store.deleteDrawing(this.board.id, drawingId);
    this.keeping.forget(this.notes.removeAnchoredTo({ type: "drawing", id: drawingId }));
    for (const { id } of cluster.members) if (id !== drawingId) this.discard(id);
    this.party.resync(sim.alices().length);
    this.camera.resumeFollowing();
    this.stuck.reset(this.clock.nowMs);
    this.voice.remark(INCARNATED_LINE(name), HINT_LIFETIME_MS);
    const look = sim.snapshot().alice?.look;
    const alive =
      look?.kind === "drawn"
        ? [
            ...(look.abilities.walk ? (["legs"] as const) : []),
            ...(look.abilities.climb ? (["arms"] as const) : []),
            ...(look.abilities.see ? (["head"] as const) : []),
          ]
        : [];
    const partsLine = INCARNATED_PARTS_LINE(alive);
    if (partsLine !== null) this.voice.remark(partsLine, HINT_LIFETIME_MS);
  }

  private lose(cause: keyof typeof ROOM_RESTARTS_LINES): void {
    switch (this.director.mode.loss.kind) {
      case "respawn":
        return;
      case "unmade":
        this.modules.sim.disembody();
        this.party.resync(this.modules.sim.alices().length);
        this.voice.remark(UNMADE_LINE, HINT_LIFETIME_MS);
        return;
      case "board-restarts":
        this.voice.remark(ROOM_RESTARTS_LINES[cause], HINT_LIFETIME_MS);
        this.restartDueAtMs = this.clock.nowMs + RESTART_AFTER_MS;
        return;
    }
  }

  private restart(): void {
    this.restartDueAtMs = null;
    void this.open(this.board.id, { blank: true });
    const { card } = this.director.mode;
    if (card.again !== undefined) this.hud.showTitleCard({ ...card, ...card.again });
  }

  private mourn(nature: Nature): void {
    const lines = PERISHED_LINES[nature];
    const { nowMs } = this.clock;
    if (lines === undefined || nowMs - this.lastPerishedRemarkMs < PERISHED_REMARK_GAP_MS) return;
    this.lastPerishedRemarkMs = nowMs;
    this.voice.remark(this.cycles.next(lines));
  }

  /** Ink stays off Alice, except where she is made of it: a drawn body is drawn around, and mended by drawing on. */
  private inkKeepsOff(): Rect | null {
    return this.director.mode.opening.player === "spirit"
      ? null
      : this.modules.sim.aliceBounds(this.party.selected);
  }

  private enterZone(zoneId: string): void {
    const zone = this.board.zones.find((candidate) => candidate.id === zoneId);
    if (zone !== undefined) this.introduce(zone);
  }

  private introduce(zone: Zone): void {
    if (this.introduced.has(zone.id)) return;
    this.introduced.add(zone.id);
    this.modules.cat.enterRoom(zone);
    this.stuck.reset(this.clock.nowMs);
    if (this.introducesItself) return;
    const position = {
      x: zone.checkpoint.x + ABOVE_ALICE.x,
      y: zone.checkpoint.y + ABOVE_ALICE.y - 80,
    };
    if (this.director.room === null) this.voice.remark(zone.intro, HINT_LIFETIME_MS, position);
    else
      this.voice.recite([zone.intro], HINT_LIFETIME_MS, roomCardShownMs() + CARD_READ_MS, position);
  }

  private progress(line: string): void {
    this.voice.remark(line);
    this.stuck.progress(this.clock.nowMs);
  }

  private offerHelp(): void {
    const line = this.modules.cat.offerHelp();
    if (line !== null) this.voice.remark(`${line} ${OFFER_HELP_HINT}`, HINT_LIFETIME_MS);
    this.stuck.reset(this.clock.nowMs);
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
    const current = this.clock.pageGuard();
    try {
      do {
        this.glimpseAgain = false;
        const strokes = this.ink.activeStrokes.map((stroke) => [...stroke]);
        const seen = await this.modules.cat.glimpse(strokes);
        if (!current() || !this.ink.isDrawing) return;
        if (seen !== null) this.writeGlimpse(seen, strokes);
      } while (this.glimpseAgain);
    } finally {
      this.glimpsing = false;
    }
  }

  private writeGlimpse(seen: Sighting, strokes: readonly Stroke[]): void {
    if (this.glimpse?.word === seen.word) return;
    this.forgetGlimpse();
    const note = this.voice.write(`${seen.name}?`, guessCornerOf(strokes), {
      lifetimeMs: GLIMPSE_LIFETIME_MS,
      drift: "down",
      spoken: false,
    });
    this.glimpse = { noteId: note.id, word: seen.word };
  }

  private forgetGlimpse(): void {
    if (this.glimpse === null) return;
    this.notes.remove(this.glimpse.noteId);
    this.glimpse = null;
  }

  private land(drawing: Drawing): void {
    const { sim } = this.modules;
    if (this.embodied && sim.graft(drawing.strokes)) return;
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
    await this.interpret(text, writingOrigin(drawing.strokes));
  }

  private async readWords(
    strokes: readonly Stroke[],
    reading: Promise<string | null>,
  ): Promise<void> {
    const current = this.clock.pageGuard();
    const text = await reading;
    if (text !== null && current()) await this.interpret(text, writingOrigin(strokes));
  }

  private perform(action: NoteAction, offered: Note): void {
    const label = this.playerWrites(action.name, offered.position);
    if (action.ruling === undefined) void this.naming.nameAs(action.drawingId, action.name, label);
    else this.naming.name(action.drawingId, this.modules.cat.accept(action.ruling), label);
  }

  private async promptAt(client: Vec, world: Vec): Promise<void> {
    const current = this.clock.pageGuard();
    const text = await this.hud.promptText(client);
    if (text !== null && current()) await this.interpret(text, world);
  }

  /**
   * The one funnel: a request for help, a law of physics, a wish for things, a name for a drawing,
   * or a remark. Whatever is instant is tried first; the model is only asked about what nothing
   * else understood. A bare name ("a rabbit") beside a drawing names it; anywhere else it summons.
   */
  private async interpret(text: string, position: Vec): Promise<void> {
    if (text.length > INPUT_LIMITS.text) {
      this.voice.remark(TEXT_LIMIT_MESSAGE);
      return;
    }
    if (!isInputPoint(position)) {
      this.voice.remark(REJECTION_LINES["out-of-bounds"]);
      return;
    }
    if (isUnderGround(position, groundSolids(this.board))) return;
    if (isHelpRequest(text) || (this.counselsOnRequest && isIdeaRequest(text))) {
      await this.askForHint(position);
      return;
    }
    const note = this.playerWrites(text, position);
    const stillHere = this.witness(note.id);
    await this.answer(text, note, stillHere);
    if (stillHere()) this.notes.release(note.id, this.clock.nowMs, NOTE_LINGER_MS);
  }

  private async answer(text: string, note: Note, stillHere: () => boolean): Promise<void> {
    const { compiler, thinker, summoner, cat } = this.modules;
    const beside = this.drawingNear(note.id);
    const context = contextBeside(beside);
    const law = await compiler.compile(text, context);
    if (!stillHere()) return;
    if (law !== null) {
      this.laws.enactIfAllowed(this.laws.ruleFrom(law, note));
      return;
    }
    if (beside !== null && beside.ruling === null && speaksOfReferent(text)) {
      this.voice.remarkUnder(note.id, NAME_IT_FIRST_LINE);
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

    const subject = this.naming.bodyNamed(text) ?? this.drawingNear(note.id);
    const nameless = subject !== null && subject.ruling === null;
    const wish = (await summoner?.wish(text)) ?? null;
    if (!stillHere()) return;
    if (wish !== null && (wish.explicit || subject === null)) {
      await this.conjurer.summon(wish, note, stillHere);
      return;
    }

    const ruling = subject === null ? null : await cat.name(text, subject.drawing);
    if (!stillHere()) return;
    if (subject !== null && ruling !== null && ruling.nature !== "ink") {
      this.naming.name(subject.drawing.id, ruling, note);
      return;
    }
    if (wish !== null && !nameless) {
      await this.conjurer.summon(wish, note, stillHere);
      return;
    }

    const thought = await this.voice.ponderUnder(note.id, () => thinker.compile(text, context));
    if (!stillHere()) return;
    if (thought !== null) this.laws.enactIfAllowed(this.laws.ruleFrom(thought, note));
    else if (subject !== null && ruling !== null)
      this.naming.name(subject.drawing.id, ruling, note);
    else if (where !== null) this.voice.remarkUnder(note.id, NOWHERE_LINE(where));
    else this.voice.remarkUnder(note.id, this.cycles.next(SHRUGS));
  }

  /** A place the atlas knows is there at once; for anywhere else the model is asked, and Kami says so. */
  private async sceneOf(text: string, where: string, noteId: NoteId): Promise<Destination | null> {
    const { scenes } = this.modules;
    if (scenes === undefined) return null;
    if (placeCalled(where) !== null) return scenes.compile(text);
    return this.voice.ponderUnder(noteId, () => scenes.compile(text));
  }

  /**
   * "Teleport us to the moon": every law of the place is enacted at once, all bound to the one
   * note (erase it, or tap the scene in the laws panel, and everyone comes home), and Kami dresses
   * the place with props of his own, one after another. A place the mode forbids is refused whole.
   */
  private async travel(scene: Destination, note: Note, stillHere: () => boolean): Promise<void> {
    const rules = scene.laws.map((law) => ({
      ...this.laws.ruleFrom(law, note),
      scene: scene.place,
    }));
    const forbidden = rules.find((rule) => !this.laws.allows(rule));
    if (forbidden !== undefined) {
      this.laws.refuse(note.id, forbidden.effect.governs);
      return;
    }
    for (const { noteId } of this.laws.all.filter((rule) => rule.scene !== undefined))
      this.eraseNote(noteId);
    this.laws.enactAll(
      rules,
      note.id,
      sceneGlossOf(
        scene.place,
        rules.map((rule) => rule.explanation),
      ),
    );
    this.voice.remark(scene.line);
    await this.conjurer.dress(scene, note, stillHere);
  }

  private witness(noteId: NoteId): () => boolean {
    const current = this.clock.pageGuard();
    return () => current() && this.notes.get(noteId) !== null;
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

  private pinArena(viewport: { readonly width: number; readonly height: number }): void {
    this.camera.pin({ x: 0, y: -arenaHeight(this.board) / 2 + 18 }, framingZoom(viewport));
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
      nowMs: this.clock.nowMs,
      drift: "down",
    });
    this.store.saveNote(this.board.id, note);
    this.keeping.answerFor(note.id);
    this.handiwork.record({ kind: "note", id: note.id });
    return note;
  }

  private eraseAt(point: Vec): void {
    const { sim, findDrawingAt } = this.modules;
    const tolerance = ERASER_TOLERANCE / this.camera.camera.zoom;
    const id = findDrawingAt(point, this.ledger.posed(sim.snapshot().drawings), tolerance);
    if (id !== null) {
      this.ink.refund(this.handiwork.costOf(id));
      this.discard(id);
      return;
    }
    const written = this.notes.at(point, isPlayers);
    if (written !== null) this.eraseNote(written.id);
  }

  private eraseNote(id: NoteId): void {
    this.keeping.forget(this.notes.remove(id));
    this.laws.repealNote(id);
  }

  private discard(id: DrawingId): void {
    if (this.ledger.remove(id) === null) return;
    this.modules.sim.removeDrawing(id);
    this.party.invalidate();
    this.store.deleteDrawing(this.board.id, id);
    this.keeping.forget(this.notes.removeAnchoredTo({ type: "drawing", id }));
  }

  private drawingNear(noteId: NoteId): InkRecord | null {
    const written = this.notes.boundsOf(noteId);
    if (written === null) return null;
    const near = nearestInk(written, this.modules.sim.snapshot().drawings, this.ledger);
    return near !== null && near.gap <= NAMING_REACH ? near.record : null;
  }

  private toWorld(client: Vec): Vec {
    return this.modules.renderer.toWorld(client, this.camera.camera);
  }

  private penPointToWorld(client: PenPoint): PenPoint {
    const world = this.toWorld(client);
    return client.pressure === undefined ? world : { ...world, pressure: client.pressure };
  }
}

/** What a pronoun in a note stands for: the named drawing it was written beside, if any. */
const contextBeside = (beside: InkRecord | null): CompileContext | undefined => {
  const ruling = beside?.ruling ?? null;
  const referent = ruling === null ? null : referentOf(ruling.name);
  return referent === null ? undefined : { referent };
};

const writingOrigin = (strokes: readonly Stroke[]): Vec => {
  const { x, y } = boundsOf(strokes.flat());
  return { x, y };
};
