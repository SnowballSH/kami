import { groundSolids } from "../../board";
import { clamp, expandRect, type Rect, type Vec } from "../../core/geometry";
import type { Note, NoteAction, NoteId } from "../../notes/types";
import type { Renderer } from "../../render/types";
import type { Hud } from "../../ui/types";
import type { GameContext } from "../context";
import { NOTE_STYLE, type NoteAnchor } from "../noteBook";
import type { Drift } from "../noteLayout";
import { PONDERING_LINE, SUMIKUI_LORE_LINE_DELAY_MS } from "./lines";

export const REMARK_LIFETIME_MS = 6_000;
export const HINT_LIFETIME_MS = 10_000;
export const MAX_REMARKS = 2;
export const ABOVE_ALICE = { x: -90, y: -120 } as const;
const HUD_WRITING_GAP = 12;
const SCREEN_MARGIN = 24;
const TOOLBAR_BAND_PX = 100;
const BOTTOM_BAND_PX = 90;
const LAWS_PANEL = { maxWidth: 300, right: 16, heightShare: 0.4 } as const;
const TEAR_CLEARANCE = { halfWidth: 40, halfHeight: 120 } as const;

export interface WriteOptions {
  readonly lifetimeMs?: number;
  readonly anchor?: NoteAnchor;
  readonly action?: NoteAction;
  readonly tone?: Note["tone"];
  readonly drift?: Drift;
  readonly minY?: number;
  /** False for decoration or a passing state, never worth reading aloud. */
  readonly spoken?: boolean;
}

export interface VoiceStage
  extends Pick<GameContext, "notes" | "camera" | "ids" | "clock" | "board"> {
  readonly hud: Pick<Hud, "announce" | "toolbarBottom">;
  readonly renderer: Pick<Renderer, "toWorld" | "viewport">;
  /** The selected Alice, whom remarks are written above. */
  aliceBounds(): Rect;
  tearAt(): Vec | null;
}

interface Recital {
  readonly atMs: number;
  readonly line: string;
  readonly current: () => boolean;
  readonly position?: Vec;
}

/** Kami's handwriting on the page: where it goes, how long it stays, and what is read aloud. */
export class Voice {
  private recital: Recital[] = [];

  constructor(private readonly stage: VoiceStage) {}

  write(text: string, position: Vec, options: WriteOptions = {}): Note {
    const { lifetimeMs, anchor, action, tone = "plain", minY, spoken = true } = options;
    const drift = options.drift ?? (anchor === undefined ? "up" : "down");
    const { ids, notes, clock } = this.stage;
    if (spoken) this.stage.hud.announce(text);
    const visible = this.visibleWorld();
    const at =
      anchor === undefined
        ? {
            ...position,
            x: clamp(
              position.x,
              visible.x + SCREEN_MARGIN,
              visible.x + visible.width - NOTE_STYLE.kami.maxWidth - SCREEN_MARGIN,
            ),
          }
        : position;
    const groundTop = this.groundTopUnder(at);
    return notes.write({
      note: {
        id: ids.next<NoteId>("kami"),
        author: "kami",
        text,
        position: at,
        tone,
        createdAt: Date.now(),
        fleeting: lifetimeMs !== undefined,
        ...(action === undefined ? {} : { action }),
      },
      nowMs: clock.nowMs,
      drift,
      ...(lifetimeMs === undefined ? {} : { lifetimeMs }),
      ...(anchor === undefined ? {} : { anchor }),
      ...(minY === undefined ? {} : { minY }),
      ...(groundTop === undefined ? {} : { maxY: groundTop }),
      obstacles: this.obstacles(),
      within: visible,
    });
  }

  /** A passing word above the selected Alice (or `at`); never twice at once, and never more than `MAX_REMARKS`. */
  remark(line: string, lifetimeMs = REMARK_LIFETIME_MS, at?: Vec): void {
    const { notes, clock } = this.stage;
    const fleeting = notes.fleetingBy("kami");
    if (fleeting.some((note) => note.text === line)) return;
    for (const note of fleeting.slice(0, Math.max(0, fleeting.length - MAX_REMARKS + 1)))
      notes.hurry(note.id, clock.nowMs);
    const alice = this.aliceBounds();
    this.write(line, at ?? { x: alice.x + ABOVE_ALICE.x, y: alice.y + ABOVE_ALICE.y }, {
      lifetimeMs,
      minY: this.writingTop(),
    });
  }

  /** A passing word under a note. */
  remarkUnder(noteId: NoteId, line: string): void {
    const under = this.stage.notes.below(noteId);
    if (under !== null) this.write(line, under, { lifetimeMs: REMARK_LIFETIME_MS, drift: "down" });
  }

  /** What Kami understood a note to say, kept under it for as long as it stands. */
  gloss(noteId: NoteId, gloss: string): void {
    const under = this.stage.notes.below(noteId);
    if (under === null) return;
    this.write(gloss, under, {
      anchor: { type: "note", id: noteId },
      tone: "understood",
      drift: "down",
    });
  }

  /** Kami says he is thinking under a note for as long as `think` takes. */
  async ponderUnder<Thought>(noteId: NoteId, think: () => Promise<Thought>): Promise<Thought> {
    const { notes } = this.stage;
    const under = notes.below(noteId);
    const pondering: NoteAnchor = { type: "note", id: noteId };
    if (under !== null)
      this.write(PONDERING_LINE, under, { anchor: pondering, drift: "down", spoken: false });
    try {
      return await think();
    } finally {
      notes.removeAnchoredTo(pondering);
    }
  }

  /** Remarks spoken one after another, replacing any recital under way; dropped if the board changes. */
  recite(
    lines: readonly string[],
    delayMs = SUMIKUI_LORE_LINE_DELAY_MS,
    startAfterMs = 0,
    position?: Vec,
  ): void {
    const { clock } = this.stage;
    const current = clock.pageGuard();
    this.recital = lines.map((line, index) => ({
      atMs: clock.nowMs + startAfterMs + index * delayMs,
      line,
      current,
      ...(position === undefined ? {} : { position }),
    }));
  }

  hush(): void {
    this.recital = [];
  }

  speakDue(): void {
    const { nowMs } = this.stage.clock;
    if (!this.recital.some(({ atMs }) => atMs <= nowMs)) return;
    const due = this.recital.filter(({ atMs }) => atMs <= nowMs);
    this.recital = this.recital.filter(({ atMs }) => atMs > nowMs);
    for (const { line, current, position } of due)
      if (current()) this.remark(line, HINT_LIFETIME_MS, position);
  }

  private aliceBounds(): Rect {
    return this.stage.aliceBounds();
  }

  private writingTop(): number {
    return this.toWorld({ x: 0, y: this.stage.hud.toolbarBottom() + HUD_WRITING_GAP }).y;
  }

  private toWorld(client: Vec): Vec {
    return this.stage.renderer.toWorld(client, this.stage.camera.camera);
  }

  private visibleWorld(): Rect {
    const { width, height } = this.stage.renderer.viewport();
    return this.screenToWorld({ x: 0, y: 0, width, height });
  }

  private screenToWorld({ x, y, width, height }: Rect): Rect {
    const corners = [
      { x, y },
      { x: x + width, y },
      { x, y: y + height },
      { x: x + width, y: y + height },
    ].map((corner) => this.toWorld(corner));
    const xs = corners.map((corner) => corner.x);
    const ys = corners.map((corner) => corner.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
  }

  /** The top of the ground under a spot inside it, so a note is never written into the floor. */
  private groundTopUnder(position: Vec): number | undefined {
    const solids = groundSolids(this.stage.board).filter(
      ({ x, width }) => position.x >= x && position.x <= x + width,
    );
    if (solids.length === 0 || solids.every(({ y, height }) => position.y <= y + height)) {
      return undefined;
    }
    return Math.min(...solids.map(({ y }) => y)) - 12;
  }

  /** What Kami writes around: the board's solids, the selected Alice, the HUD and the tear. */
  private obstacles(): readonly Rect[] {
    const { board, renderer } = this.stage;
    const tear = this.stage.tearAt();
    const { width, height } = renderer.viewport();
    const lawsWidth = Math.min(LAWS_PANEL.maxWidth, Math.max(0, width - 2 * LAWS_PANEL.right));
    const lawsRight = width - LAWS_PANEL.right;
    const lawsBottom = Math.min(height, TOOLBAR_BAND_PX + height * LAWS_PANEL.heightShare);
    return [
      ...board.solids.map(({ rect }) => rect),
      expandRect(this.aliceBounds(), 12),
      this.screenToWorld({ x: 0, y: 0, width, height: TOOLBAR_BAND_PX }),
      this.screenToWorld({
        x: lawsRight - lawsWidth,
        y: TOOLBAR_BAND_PX,
        width: lawsWidth,
        height: lawsBottom - TOOLBAR_BAND_PX,
      }),
      this.screenToWorld({ x: 0, y: height - BOTTOM_BAND_PX, width, height: BOTTOM_BAND_PX }),
      ...(tear === null
        ? []
        : [
            {
              x: tear.x - TEAR_CLEARANCE.halfWidth,
              y: tear.y - TEAR_CLEARANCE.halfHeight,
              width: 2 * TEAR_CLEARANCE.halfWidth,
              height: 2 * TEAR_CLEARANCE.halfHeight,
            },
          ]),
    ];
  }
}
