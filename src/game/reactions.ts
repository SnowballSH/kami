import type { Zone } from "../board/types";
import type { Nature } from "../cat/types";
import type { DrawingId } from "../ink/types";
import { EMBODIED_MODE_ID } from "../modes";
import type { EmbodimentTransition, ModeDirector } from "../modes/types";
import { BODY_TUNING } from "../sim/boss/tuning";
import type { SimEvent } from "../sim/types";
import { roomCardShownMs } from "../ui/roomCard";
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
  TEAR_CLOSED_LINE,
  TEAR_LINE_DELAY_MS,
  TEAR_OPENS_LINES,
  UNMADE_LINE,
} from "./bossLines";
import type { GameContext } from "./context";
import type { Eraser } from "./eraser";
import { bodyCluster } from "./inkNearby";
import { LineCycles } from "./lineCycles";
import {
  ALICE_CORNERED_LINE,
  ALICE_FLEES_LINES,
  aboutAlice,
  DEVOURED_ROOM_RESTARTS_LINE,
  DOOR_OPENED_LINE,
  FELL_OFF_PAGE_LINE,
  GOAL_LINE,
  GROW_BLOCKED_LINE,
  IN_THE_DARK_LINE,
  KEY_TAKEN_LINE,
  OFFER_HELP_HINT,
  PERISHED_LINES,
  PORTAL_LONELY_LINE,
  STUCK_LINE,
  SUMIKUI_ALICE_DEVOURED_LINES,
  SUMIKUI_DEVOURED_LINES,
  SUMIKUI_PAPER_BITTEN_LINES,
  SUMIKUI_WOKE_LINE,
  TWIN_GOAL_LINE,
  WARPED_LINES,
} from "./lines";
import type { NoteKeeping } from "./noteKeeping";
import type { News } from "./party";
import { ABOVE_ALICE, HINT_LIFETIME_MS, type Voice } from "./voice";

/** Long enough to read the closing line where she stands before the next room opens over it. */
const NEXT_ROOM_DELAY_MS = 4_000;
/** Long enough to read that the heart was taken before the room opens over. */
const RESTART_AFTER_MS = 2_800;
/** A heatwave takes drawings by the handful; Kami mourns them once in a while, not one by one. */
const PERISHED_REMARK_GAP_MS = 8_000;
export const CARD_READ_MS = 600;
const ZONE_INTRO_RISE = 80;
const ROOM_RESTARTS_LINES: Readonly<Record<"fell" | "devoured" | "swallowed", string>> = {
  fell: UNMADE_LINE,
  devoured: DEVOURED_ROOM_RESTARTS_LINE,
  swallowed: HEART_SWALLOWED_LINE,
};

/** A mode other than today's play introduces itself, unless the room it stages opens on a card of its own. */
export const introducesItself = (director: ModeDirector): boolean =>
  director.mode.id !== EMBODIED_MODE_ID && director.room === null;

export interface Reopener {
  /** `blank` opens the same page again emptied. */
  open(boardId: string, options?: { readonly blank?: boolean }): void;
}

/** What Kami does and says as the story unfolds: what the sim reports, and what the mode rules of it. */
export class Reactions {
  private readonly cycles = new LineCycles();
  private readonly introduced = new Set<string>();
  private lastMournedAtMs = Number.NEGATIVE_INFINITY;
  private nextRoom: { readonly boardId: string; readonly atMs: number } | null = null;
  private restartAtMs: number | null = null;

  constructor(
    private readonly context: GameContext,
    private readonly voice: Voice,
    private readonly keeping: NoteKeeping,
    private readonly eraser: Eraser,
    private readonly reopener: Reopener,
  ) {}

  /** A board opened: nothing is scheduled, and every zone is new again. */
  reset(): void {
    this.introduced.clear();
    this.nextRoom = null;
    this.restartAtMs = null;
  }

  frame(): void {
    const { clock, director, stuck } = this.context;
    const { nowMs } = clock;
    if (this.restartAtMs !== null && nowMs >= this.restartAtMs) this.restart();
    if (director.state.kind === "body" && director.mode.help === "offered" && stuck.isStuck(nowMs))
      this.offerHelp();
    if (this.nextRoom !== null && nowMs >= this.nextRoom.atMs)
      this.reopener.open(this.nextRoom.boardId);
  }

  /** What the pilots just found out about their Alices. */
  hear(news: readonly News[]): void {
    for (const { who, kind } of news) {
      switch (kind) {
        case "flees":
          this.voice.remark(aboutAlice(who, this.cycles.next(ALICE_FLEES_LINES)));
          break;
        case "cornered":
          this.voice.remark(aboutAlice(who, ALICE_CORNERED_LINE));
          break;
        case "stuck":
          if (who === this.context.party.selected) this.voice.remark(STUCK_LINE);
          break;
      }
    }
  }

  witness(event: SimEvent): void {
    const { director, party, stuck, clock } = this.context;
    if (director.won(event)) this.celebrate(event);
    const transitions = director.witness(event);
    for (const transition of transitions) this.embody(transition);
    const unmade = transitions.some((transition) => transition.kind === "unmade");
    const { voice, cycles, eraser } = this;
    switch (event.type) {
      case "fell":
        if (event.who === party.selected) {
          stuck.fell();
          if (director.mode.page === "endless") voice.remark(FELL_OFF_PAGE_LINE, HINT_LIFETIME_MS);
        }
        return;
      case "zone-entered": {
        const zone = this.context.board.zones.find(({ id }) => id === event.zoneId);
        if (zone !== undefined) this.introduce(zone);
        return;
      }
      case "key-taken":
        this.progress(KEY_TAKEN_LINE);
        return;
      case "door-opened":
        this.progress(DOOR_OPENED_LINE);
        return;
      case "bounced":
        stuck.progress(clock.nowMs);
        return;
      case "consumed":
        eraser.discard(event.drawingId);
        stuck.progress(clock.nowMs);
        return;
      case "perished":
        eraser.discard(event.drawingId);
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
        eraser.discard(event.drawingId);
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
        if (event.who === party.selected) stuck.progress(clock.nowMs);
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
        eraser.discard(event.drawingId);
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

  /** Enacts what the director ruled about her body: a drawing becomes her, the tear opens, or she is unmade. */
  embody(transition: EmbodimentTransition): void {
    switch (transition.kind) {
      case "incarnated":
        if (transition.by !== "spawn") this.incarnate(transition.drawingId, transition.name);
        return;
      case "tear-opens":
        this.context.modules.sim.openTear();
        this.voice.recite(TEAR_OPENS_LINES, TEAR_LINE_DELAY_MS);
        return;
      case "unmade":
        this.lose(transition.cause);
        return;
    }
  }

  /** Kami introduces a zone the first time Alice is in it. */
  introduce(zone: Zone): void {
    const { modules, stuck, clock, director } = this.context;
    if (this.introduced.has(zone.id)) return;
    this.introduced.add(zone.id);
    modules.cat.enterRoom(zone);
    stuck.reset(clock.nowMs);
    if (introducesItself(director)) return;
    const position = {
      x: zone.checkpoint.x + ABOVE_ALICE.x,
      y: zone.checkpoint.y + ABOVE_ALICE.y - ZONE_INTRO_RISE,
    };
    if (director.room === null) this.voice.remark(zone.intro, HINT_LIFETIME_MS, position);
    else
      this.voice.recite([zone.intro], HINT_LIFETIME_MS, roomCardShownMs() + CARD_READ_MS, position);
  }

  /** The room is won: Kami's closing line, and in a run of rooms the next one opens once it has been read. */
  private celebrate(event: SimEvent): void {
    const { director, clock, modules } = this.context;
    const { room, mode } = director;
    if (room !== null) {
      this.voice.remark(room.closing, HINT_LIFETIME_MS);
      if (room.next === null) this.showWonCard();
      else this.nextRoom = { boardId: room.next, atMs: clock.nowMs + NEXT_ROOM_DELAY_MS };
      return;
    }
    if (event.type === "tear-closed" && mode.win.kind === "defeat-foe") this.showWonCard();
    const line =
      event.type === "tear-closed"
        ? TEAR_CLOSED_LINE
        : event.type === "goal-reached" && modules.sim.alices().length !== 1
          ? TWIN_GOAL_LINE(event.who)
          : GOAL_LINE;
    this.voice.remark(line, HINT_LIFETIME_MS);
  }

  private showWonCard(): void {
    const { card } = this.context.director.mode;
    if (card.won !== undefined) this.context.hud.showTitleCard({ ...card, ...card.won });
  }

  /** The drawing, and the unnamed ink joined to it around the heart, becomes her body. */
  private incarnate(drawingId: DrawingId, name: string): void {
    const { modules, ledger, store, board, notes, party, camera, stuck, clock } = this.context;
    const { sim } = modules;
    const { soul, drawings } = sim.snapshot();
    if (soul === null) return;
    const cluster = bodyCluster(drawingId, soul.at, drawings, ledger, BODY_TUNING.graftReach);
    if (cluster === null || !sim.incarnate(drawingId, name, cluster.strokes)) return;
    ledger.remove(drawingId);
    store.deleteDrawing(board.id, drawingId);
    this.keeping.forget(notes.removeAnchoredTo({ type: "drawing", id: drawingId }));
    for (const { id } of cluster.members) if (id !== drawingId) this.eraser.discard(id);
    party.resync(sim.alices().length);
    camera.resumeFollowing();
    stuck.reset(clock.nowMs);
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
    const { director, modules, party, clock } = this.context;
    switch (director.mode.loss.kind) {
      case "respawn":
        return;
      case "unmade":
        modules.sim.disembody();
        party.resync(modules.sim.alices().length);
        this.voice.remark(UNMADE_LINE, HINT_LIFETIME_MS);
        return;
      case "board-restarts":
        this.voice.remark(ROOM_RESTARTS_LINES[cause], HINT_LIFETIME_MS);
        this.restartAtMs = clock.nowMs + RESTART_AFTER_MS;
        return;
    }
  }

  private restart(): void {
    this.restartAtMs = null;
    this.reopener.open(this.context.board.id, { blank: true });
    const { card } = this.context.director.mode;
    if (card.again !== undefined) this.context.hud.showTitleCard({ ...card, ...card.again });
  }

  private mourn(nature: Nature): void {
    const lines = PERISHED_LINES[nature];
    const { nowMs } = this.context.clock;
    if (lines === undefined || nowMs - this.lastMournedAtMs < PERISHED_REMARK_GAP_MS) return;
    this.lastMournedAtMs = nowMs;
    this.voice.remark(this.cycles.next(lines));
  }

  private progress(line: string): void {
    this.voice.remark(line);
    this.context.stuck.progress(this.context.clock.nowMs);
  }

  private offerHelp(): void {
    const line = this.context.modules.cat.offerHelp();
    if (line !== null) this.voice.remark(`${line} ${OFFER_HELP_HINT}`, HINT_LIFETIME_MS);
    this.context.stuck.reset(this.context.clock.nowMs);
  }
}
