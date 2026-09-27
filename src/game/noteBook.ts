import { clamp, expandRect, type Rect, rectContains, type Vec } from "../core/geometry";
import type { Handwriting, PenScript } from "../handwriting/types";
import type { DrawingId } from "../ink/types";
import type { Note, NoteId } from "../notes/types";
import type { NoteView } from "../render/types";
import { type Drift, settle } from "./noteLayout";

export const NOTE_FADE_MS = 700;
const TAP_MARGIN = 12;
const LINE_GAP = 10;
const ALREADY_WRITTEN_MS = 60_000;

export const NOTE_STYLE = {
  player: { size: 30, maxWidth: 520 },
  kami: { size: 26, maxWidth: 460 },
} as const;

const translate = ({ x, y }: Vec, by: Vec): Vec => ({ x: x + by.x, y: y + by.y });

/** Handwriting does not depend on where it is written, so a draft is moved rather than rewritten. */
const shifted = (script: PenScript, by: Vec): PenScript =>
  by.x === 0 && by.y === 0
    ? script
    : {
        ...script,
        strokes: script.strokes.map((stroke) =>
          stroke.map((point) => ({ ...point, ...translate(point, by) })),
        ),
        bounds: { ...script.bounds, ...translate(script.bounds, by) },
      };

/** The bounds moved inside `within` and above `maxY`, as far as they fit. */
const clampedWithin = (bounds: Rect, within: Rect | undefined, maxY = Infinity): Rect => {
  if (within === undefined) return bounds;
  const right = within.x + within.width - bounds.width;
  const bottom = Math.min(within.y + within.height, maxY) - bounds.height;
  return {
    ...bounds,
    x: clamp(bounds.x, Math.min(within.x, right), Math.max(within.x, right)),
    y: clamp(bounds.y, Math.min(within.y, bottom), Math.max(within.y, bottom)),
  };
};

/** What a note hangs off: erase the anchor and the note goes with it. */
export type NoteAnchor =
  | { readonly type: "note"; readonly id: NoteId }
  | { readonly type: "drawing"; readonly id: DrawingId };

interface Entry {
  readonly note: Note;
  readonly script: PenScript;
  readonly writtenAtMs: number;
  readonly expiresAtMs: number | null;
  readonly anchor: NoteAnchor | null;
}

export interface NotePlacement {
  readonly note: Note;
  readonly nowMs: number;
  readonly lifetimeMs?: number;
  readonly anchor?: NoteAnchor;
  /** Slide the note clear of writing already on the board, this way first. Omit to pin it. */
  readonly drift?: Drift;
  readonly minY?: number;
  readonly maxY?: number;
  readonly obstacles?: readonly Rect[];
  readonly within?: Rect;
}

/** Everything written on the board, as pen scripts ready to be revealed stroke by stroke. */
export class NoteBook {
  private readonly entries = new Map<NoteId, Entry>();
  private seed = 1;

  constructor(private readonly handwriting: Handwriting) {}

  /** Inscribes the note and returns it as placed, which may sit above or below where it was asked for. */
  write({
    note,
    nowMs,
    lifetimeMs,
    anchor,
    drift,
    minY,
    maxY,
    obstacles,
    within,
  }: NotePlacement): Note {
    const draft = this.scriptFor(note, this.seed + 1, within);
    const wanted =
      drift === undefined
        ? draft.bounds
        : this.clearSpotFor(draft.bounds, drift, minY, maxY, obstacles ?? [], within);
    const bounds = clampedWithin(wanted, within, maxY);
    const by = { x: bounds.x - draft.bounds.x, y: bounds.y - draft.bounds.y };
    const placed = { ...note, position: translate(note.position, by) };
    return this.inscribe(placed, nowMs, anchor ?? null, lifetimeMs, within, shifted(draft, by))
      .note;
  }

  /**
   * A note written elsewhere, by a previous session or another device: already on the board, fully
   * written, exactly where it was written, and gone after `lifetimeMs`.
   */
  restore(note: Note, nowMs: number, lifetimeMs: number): void {
    const anchor: NoteAnchor | null =
      note.drawingId === undefined ? null : { type: "drawing", id: note.drawingId };
    this.inscribe(note, nowMs - ALREADY_WRITTEN_MS, anchor);
    this.release(note.id, nowMs, lifetimeMs);
  }

  /** Lets a note that was written to stay go after `lifetimeMs`, unless it was already leaving sooner. */
  release(id: NoteId, nowMs: number, lifetimeMs: number): void {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    const leavingAtMs = Math.max(nowMs, entry.writtenAtMs + entry.script.durationMs) + lifetimeMs;
    const expiresAtMs =
      entry.expiresAtMs === null ? leavingAtMs : Math.min(entry.expiresAtMs, leavingAtMs);
    this.entries.set(id, { ...entry, expiresAtMs });
  }

  fleetingBy(author: Note["author"]): readonly Note[] {
    return [...this.entries.values()]
      .filter(({ note, anchor }) => note.author === author && note.fleeting && anchor === null)
      .sort((a, b) => a.writtenAtMs - b.writtenAtMs)
      .map(({ note }) => note);
  }

  hurry(id: NoteId, nowMs: number): void {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    const expiresAtMs = Math.min(
      entry.expiresAtMs ?? Number.POSITIVE_INFINITY,
      nowMs + NOTE_FADE_MS,
    );
    this.entries.set(id, { ...entry, expiresAtMs });
  }

  get all(): readonly Note[] {
    return [...this.entries.values()].map(({ note }) => note);
  }

  get(id: NoteId): Note | null {
    return this.entries.get(id)?.note ?? null;
  }

  boundsOf(id: NoteId): Rect | null {
    return this.entries.get(id)?.script.bounds ?? null;
  }

  below(id: NoteId): Vec | null {
    const bounds = this.boundsOf(id);
    return bounds === null ? null : { x: bounds.x, y: bounds.y + bounds.height + LINE_GAP };
  }

  attachToDrawing(id: NoteId, drawingId: DrawingId): Note | null {
    const entry = this.entries.get(id);
    if (entry === undefined) return null;
    const note = { ...entry.note, drawingId };
    this.entries.set(id, { ...entry, note, anchor: { type: "drawing", id: drawingId } });
    return note;
  }

  restyle(id: NoteId, tone: Note["tone"]): Note | null {
    const entry = this.entries.get(id);
    if (entry === undefined) return null;
    const note = { ...entry.note, tone };
    this.entries.set(id, { ...entry, note });
    return note;
  }

  /** Removes the note and everything hanging off it; returns all that went. */
  remove(id: NoteId): readonly Note[] {
    const entry = this.entries.get(id);
    if (entry === undefined) return [];
    this.entries.delete(id);
    return [entry.note, ...this.removeAnchoredTo({ type: "note", id })];
  }

  removeAnchoredTo(anchor: NoteAnchor): readonly Note[] {
    return [...this.entries.values()]
      .filter((entry) => entry.anchor?.type === anchor.type && entry.anchor.id === anchor.id)
      .flatMap((entry) => this.remove(entry.note.id));
  }

  clear(): void {
    this.entries.clear();
  }

  /** Removes every note whose time is up, with all that hung off them; returns all that went. */
  expire(nowMs: number): readonly Note[] {
    return [...this.entries.values()]
      .filter((entry) => entry.expiresAtMs !== null && nowMs >= entry.expiresAtMs)
      .flatMap((entry) => this.remove(entry.note.id));
  }

  at(point: Vec, matches: (note: Note) => boolean): Note | null {
    const hits = [...this.entries.values()].filter(
      ({ note, script }) =>
        matches(note) && rectContains(expandRect(script.bounds, TAP_MARGIN), point),
    );
    return hits.at(-1)?.note ?? null;
  }

  views(nowMs: number): readonly NoteView[] {
    return [...this.entries.values()].map(({ note, script, writtenAtMs, expiresAtMs }) => ({
      id: note.id,
      author: note.author,
      tone: note.tone,
      script,
      writtenAtMs,
      tappable: note.action !== undefined,
      opacity:
        expiresAtMs === null ? 1 : Math.min(1, Math.max(0, (expiresAtMs - nowMs) / NOTE_FADE_MS)),
    }));
  }

  private clearSpotFor(
    wanted: Rect,
    drift: Drift,
    minY: number | undefined,
    maxY: number | undefined,
    obstacles: readonly Rect[],
    within: Rect | undefined,
  ): Rect {
    const taken = [...this.entries.values()].map((entry) => entry.script.bounds).concat(obstacles);
    return { ...wanted, ...settle(wanted, taken, drift, minY, within, maxY) };
  }

  private scriptFor(note: Note, seed: number, within?: Rect): PenScript {
    const style = NOTE_STYLE[note.author];
    return this.handwriting.write(note.text, {
      origin: note.position,
      ...style,
      maxWidth: Math.min(style.maxWidth, within?.width ?? style.maxWidth),
      seed,
    });
  }

  private inscribe(
    note: Note,
    writtenAtMs: number,
    anchor: NoteAnchor | null,
    lifetimeMs?: number,
    within?: Rect,
    written?: PenScript,
  ): Entry {
    this.seed += 1;
    const script = written ?? this.scriptFor(note, this.seed, within);
    const expiresAtMs =
      lifetimeMs === undefined ? null : writtenAtMs + script.durationMs + lifetimeMs;
    const entry = { note, script, writtenAtMs, expiresAtMs, anchor };
    this.entries.set(note.id, entry);
    return entry;
  }
}
