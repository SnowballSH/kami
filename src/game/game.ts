import type { Autopilot, Scene } from "../autopilot/types";
import type { Cat, Glance } from "../cat/types";
import type { Vec } from "../core/geometry";
import { BULLET_TIME_SCALE, FIXED_STEP_MS } from "../core/world";
import type {
  Drawing,
  DrawingId,
  InkSession,
  InkSessionListener,
  PlacementRejection,
  PosedDrawing,
} from "../ink/types";
import type { GhostInk, Renderer } from "../render/types";
import type { SimEvent, Simulation, WalkIntent } from "../sim/types";
import type { EndingEntry, Hud, HudHandlers, PenSink } from "../ui/types";
import type { WorldFacts } from "../world/types";
import { FixedStepLoop } from "./fixedStepLoop";
import { InkLedger, type InkRecord } from "./inkLedger";
import {
  DOOR_OPENED_LINE,
  GAME_TITLE_CARD,
  GROW_BLOCKED_LINE,
  KEY_TAKEN_LINE,
  pageCard,
  REFUSED_LINE,
  REJECTION_LINES,
  UNNAMED_CAPTION,
  WAITING_LINE,
} from "./lines";
import { StuckDetector } from "./stuckDetector";
import type { LevelDefinition } from "./types";
import { type PageContext, WorldDesk } from "./worldDesk";

const MAX_STEPS_PER_FRAME = 5;
const NAMING_TIMEOUT_MS = 12_000;
const ERASER_TOLERANCE = 18;
const THUMBNAIL_PX = 420;
const GHOST_FADE_MS = 1_600;

export interface GameModules {
  readonly levels: readonly LevelDefinition[];
  readonly sim: Simulation;
  readonly cat: Cat;
  readonly autopilot: Autopilot;
  readonly renderer: Renderer;
  readonly createInkSession: (listener: InkSessionListener) => InkSession;
  readonly createHud: (handlers: HudHandlers) => Hud;
  readonly findDrawingAt: (
    point: Vec,
    drawings: readonly PosedDrawing[],
    tolerance: number,
  ) => DrawingId | null;
  readonly mintDrawingId: () => DrawingId;
}

type Phase = "playing" | "between-pages" | "ending";

interface PendingNaming {
  readonly drawing: Drawing;
  readonly openedAtMs: number;
}

const isIdle = (intent: WalkIntent): boolean => intent.x === 0 && intent.y === 0;

export class Game implements PenSink, InkSessionListener, HudHandlers {
  private readonly ink: InkSession;
  private readonly hud: Hud;
  private readonly desk: WorldDesk;
  private readonly loop = new FixedStepLoop(FIXED_STEP_MS, MAX_STEPS_PER_FRAME);
  private readonly ledger = new InkLedger();
  private readonly gallery: InkRecord[] = [];
  private readonly stuck = new StuckDetector();
  private ghosts: GhostInk[] = [];

  private phase: Phase = "playing";
  private roomIndex = 0;
  private roomEpoch = 0;
  private nowMs = 0;
  private lastFrameMs = 0;
  private naming: PendingNaming | null = null;
  private eraserActive = false;
  private catHasAsked = false;
  /** Keyboard steering, for the booth and for debugging; null hands Alice back to herself. */
  private manual: WalkIntent | null = null;
  private waitingAnnounced = false;

  constructor(private readonly modules: GameModules) {
    this.ink = modules.createInkSession(this);
    this.hud = modules.createHud(this);
    this.desk = new WorldDesk({
      sim: modules.sim,
      ink: this.ink,
      ledger: this.ledger,
      mintDrawingId: modules.mintDrawingId,
    });
  }

  start(nowMs: number): void {
    this.nowMs = nowMs;
    this.lastFrameMs = nowMs;
    this.gallery.length = 0;
    this.catHasAsked = false;
    this.hud.hideEnding();
    this.enterRoom(0);
  }

  jumpToRoom(index: number): void {
    if (index < 0 || index >= this.modules.levels.length) return;
    this.hud.hideEnding();
    this.enterRoom(index);
  }

  frame(nowMs: number): void {
    const steps = this.loop.advance(nowMs - this.lastFrameMs);
    this.nowMs = nowMs;
    this.lastFrameMs = nowMs;
    if (this.phase === "playing") this.play(steps);
    this.draw();
  }

  penDown(point: Vec): void {
    if (this.phase !== "playing") return;
    if (this.eraserActive) this.eraseAt(point);
    else this.ink.penDown(point);
  }

  penMove(point: Vec): void {
    if (this.phase === "playing" && !this.eraserActive) this.ink.penMove(point);
  }

  penUp(): void {
    this.ink.penUp();
  }

  onCommit(drawing: Drawing): void {
    this.modules.sim.addDrawing(drawing);
    this.ledger.add(drawing);
    this.modules.autopilot.invalidate();
    if (this.level.namingEnabled) void this.beginNaming(drawing);
  }

  onReject(reason: PlacementRejection): void {
    this.hud.say(REJECTION_LINES[reason]);
  }

  onWalkIntent(intent: WalkIntent): void {
    this.manual = isIdle(intent) ? null : intent;
  }

  onNameChosen(name: string): void {
    void this.nameIt(name);
  }

  onNamingDismissed(): void {
    this.closeNaming();
  }

  onSpell(text: string): void {
    if (this.phase === "playing") void this.cast(text);
  }

  onAskCat(): void {
    if (this.phase === "playing") this.hud.say(this.modules.cat.hint().line);
  }

  onEraserToggled(active: boolean): void {
    this.eraserActive = active;
    this.hud.setEraserActive(active);
  }

  onResetRoom(): void {
    if (this.phase === "playing") this.enterRoom(this.roomIndex);
  }

  /** Everything the Cat, or a model behind him, may read about the room as it stands. */
  facts(): WorldFacts {
    return this.desk.facts(this.page);
  }

  private get level(): LevelDefinition {
    const level = this.modules.levels[this.roomIndex];
    if (level === undefined) throw new Error(`No room at index ${this.roomIndex}`);
    return level;
  }

  private get page(): PageContext {
    return {
      level: this.level,
      pageNumber: this.roomIndex + 1,
      pageCount: this.modules.levels.length,
    };
  }

  private get bulletTime(): boolean {
    return this.ink.isDrawing || this.naming !== null;
  }

  private get aliceWaiting(): boolean {
    return this.manual === null && this.modules.autopilot.status.stuck;
  }

  private enterRoom(index: number): void {
    const { sim, cat, renderer, levels, autopilot } = this.modules;
    this.roomIndex = index;
    this.roomEpoch += 1;
    this.phase = "playing";
    this.naming = null;
    this.ghosts = [];
    this.waitingAnnounced = false;
    const level = this.level;
    sim.loadLevel(level);
    renderer.setLevel(level);
    cat.enterRoom(level);
    autopilot.reset();
    this.ink.reset(level.ink);
    this.ledger.clear();
    this.stuck.reset(this.nowMs);
    this.onEraserToggled(false);
    this.hud.hideNaming();
    this.hud.setRoom(level.title, index + 1, levels.length);
    this.hud.say(level.intro);
  }

  private play(steps: number): void {
    const { sim } = this.modules;
    sim.setTimeScale(this.bulletTime ? BULLET_TIME_SCALE : 1);
    for (let step = 0; step < steps && this.phase === "playing"; step++) {
      sim.setWalkIntent(this.manual ?? this.modules.autopilot.drive(this.scene()));
      for (const event of sim.step()) this.handle(event);
    }
    this.ink.update(this.nowMs, {
      noInkZones: this.level.noInkZones,
      aliceBounds: sim.aliceBounds(),
    });
    if (this.naming !== null && this.nowMs - this.naming.openedAtMs > NAMING_TIMEOUT_MS) {
      this.closeNaming();
    }
    this.announceWaiting();
    if (this.stuck.isStuck(this.nowMs)) this.offerHelp();
  }

  private scene(): Scene {
    const { sim } = this.modules;
    const world = sim.snapshot();
    return {
      level: this.level,
      alice: world.alice,
      inks: this.ledger.scene(world.drawings),
      keyTaken: world.keyTaken,
      doorOpen: world.doorOpen,
      walkSpeed: sim.walkSpeed(),
      bounceArc: (strength) => sim.bounceArc(strength),
    };
  }

  private announceWaiting(): void {
    const waiting = this.aliceWaiting;
    if (waiting && !this.waitingAnnounced) this.hud.say(WAITING_LINE);
    this.waitingAnnounced = waiting;
  }

  private draw(): void {
    const world = this.modules.sim.snapshot();
    this.ghosts = this.ghosts.filter((ghost) => this.nowMs < ghost.fadeStartMs + ghost.fadeMs);
    this.modules.renderer.render({
      nowMs: this.nowMs,
      world,
      inks: this.ledger.views(world.drawings),
      ghosts: this.ghosts,
      activeStrokes: this.ink.activeStrokes,
      activeVerdict: this.ink.activeVerdict,
      bulletTime: this.phase === "playing" && this.bulletTime,
      eraserActive: this.eraserActive,
      aliceWaiting: this.phase === "playing" && this.aliceWaiting,
    });
    this.hud.setInk(this.ink.budget);
  }

  private handle(event: SimEvent): void {
    switch (event.type) {
      case "exit-reached":
        void this.clearRoom();
        return;
      case "fell":
        this.stuck.fell();
        this.modules.autopilot.invalidate();
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
        this.forget(event.drawingId);
        this.ledger.markEaten(event.drawingId);
        this.modules.autopilot.invalidate();
        this.stuck.progress(this.nowMs);
        return;
      case "grow-blocked":
        this.hud.say(GROW_BLOCKED_LINE);
        return;
    }
  }

  private progress(line: string): void {
    this.hud.say(line);
    this.stuck.progress(this.nowMs);
    this.modules.autopilot.invalidate();
  }

  private offerHelp(): void {
    const line = this.modules.cat.offerHelp();
    if (line !== null) this.hud.say(line);
    this.stuck.reset(this.nowMs);
  }

  private async beginNaming(drawing: Drawing): Promise<void> {
    const epoch = this.roomEpoch;
    this.naming = { drawing, openedAtMs: this.nowMs };
    if (!this.catHasAsked) {
      this.catHasAsked = true;
      this.hud.say(this.modules.cat.askWhatItIs());
    }
    const sketch = (): string =>
      this.modules.renderer.thumbnail(drawing, THUMBNAIL_PX).toDataURL("image/png");
    const glance = await this.modules.cat.look(drawing, sketch, this.facts());
    if (epoch !== this.roomEpoch || this.naming?.drawing.id !== drawing.id) return;
    this.heed(drawing, glance);
  }

  private heed(drawing: Drawing, glance: Glance): void {
    if (glance.kind === "picture") {
      this.hud.showNaming(glance.guesses);
      return;
    }
    this.closeNaming();
    this.letGo(drawing.id);
    void this.cast(glance.text);
  }

  /** Handwriting leaves the world the moment it is read, and lingers on the page only as a ghost. */
  private letGo(id: DrawingId): void {
    const { sim } = this.modules;
    const pose = sim.snapshot().drawings.find((posed) => posed.id === id)?.pose;
    const record = this.ledger.erase(id);
    if (record === null) return;
    sim.removeDrawing(id);
    this.ink.refund(record.drawing.cost);
    this.modules.autopilot.invalidate();
    if (pose !== undefined) {
      this.ghosts.push({
        drawing: record.drawing,
        pose,
        fadeStartMs: this.nowMs,
        fadeMs: GHOST_FADE_MS,
      });
    }
  }

  private async cast(text: string): Promise<void> {
    const epoch = this.roomEpoch;
    const decree = await this.modules.cat.command(text, this.facts());
    if (epoch !== this.roomEpoch || this.phase !== "playing") return;
    this.hud.scrawl(text);
    const outcomes = this.desk.apply(decree.edits, this.page, this.nowMs);
    const refused = outcomes.find((outcome) => !outcome.applied);
    if (outcomes.some((outcome) => outcome.applied)) this.progress(decree.line);
    else this.hud.say(refused?.reason === undefined ? decree.line : REFUSED_LINE(refused.reason));
  }

  private async nameIt(utterance: string): Promise<void> {
    const pending = this.naming;
    if (pending === null) return;
    const epoch = this.roomEpoch;
    this.closeNaming();
    const { id } = pending.drawing;
    const ruling = await this.modules.cat.name(utterance, pending.drawing, this.facts());
    if (epoch !== this.roomEpoch || !this.ledger.has(id)) return;
    this.modules.sim.applyRuling(id, ruling);
    this.ledger.awaken(id, ruling, this.nowMs);
    this.progress(ruling.line);
  }

  private closeNaming(): void {
    this.naming = null;
    this.hud.hideNaming();
  }

  private forget(id: DrawingId): void {
    if (this.naming?.drawing.id === id) this.closeNaming();
  }

  private eraseAt(point: Vec): void {
    const { sim, findDrawingAt } = this.modules;
    const id = findDrawingAt(point, this.ledger.posed(sim.snapshot().drawings), ERASER_TOLERANCE);
    if (id === null) return;
    const record = this.ledger.erase(id);
    if (record === null) return;
    this.forget(id);
    sim.removeDrawing(id);
    this.ink.refund(record.drawing.cost);
    this.modules.autopilot.invalidate();
  }

  private async clearRoom(): Promise<void> {
    const { levels } = this.modules;
    this.phase = "between-pages";
    this.closeNaming();
    this.gallery.push(...this.ledger.everything());
    const next = this.roomIndex + 1;
    const nextLevel = levels[next];
    if (nextLevel === undefined) {
      this.showEnding();
      return;
    }
    await this.hud.showTitleCard(
      this.roomIndex === 0 ? GAME_TITLE_CARD : pageCard(nextLevel.title, next + 1),
    );
    this.enterRoom(next);
  }

  private showEnding(): void {
    this.phase = "ending";
    const entries: readonly EndingEntry[] = this.gallery.map(({ drawing, ruling }) => ({
      name: ruling?.name ?? UNNAMED_CAPTION,
      thumbnail: this.modules.renderer.thumbnail(drawing, THUMBNAIL_PX),
    }));
    this.hud.showEnding(entries, () => this.start(this.nowMs));
  }
}
