import { expandRect, type Rect, rectContains, type Vec } from "../core/geometry";
import type { Handwriting, PenScript } from "../handwriting/types";
import type { DrawingId } from "../ink/types";
import type { Note, NoteId } from "../notes/types";
import type { NoteView } from "../render/types";
import { type Drift, settle } from "./noteLayout";

const FADE_MS = 700;
const TAP_MARGIN = 12;
const LINE_GAP = 10;
const ALREADY_WRITTEN_MS = 60_000;

export const NOTE_STYLE = {
  player: { size: 30, maxWidth: 520 },
  kami: { size: 26, maxWidth: 460 },
} as const;

/** What a note hangs off: erase the anchor and the note goes with it. Not persisted. */
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
}

/** Everything written on the board, as pen scripts ready to be revealed stroke by stroke. */
export class NoteBook {
  private readonly entries = new Map<NoteId, Entry>();
  private seed = 1;

  constructor(private readonly handwriting: Handwriting) {}

  /** Inscribes the note and returns it as placed, which may sit above or below where it was asked for. */
  write({ note, nowMs, lifetimeMs, anchor, drift, minY }: NotePlacement): Note {
    const placed = drift === undefined ? note : this.clearSpotFor(note, drift, minY);
    return this.inscribe(placed, nowMs, anchor ?? null, lifetimeMs).note;
  }

  /** A note from a previous session: already on the board, fully written. */
  restore(note: Note, nowMs: number): void {
    this.inscribe(note, nowMs - ALREADY_WRITTEN_MS, null);
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

  attach(id: NoteId, anchor: NoteAnchor): void {
    const entry = this.entries.get(id);
    if (entry !== undefined) this.entries.set(id, { ...entry, anchor });
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

  expire(nowMs: number): void {
    for (const entry of this.entries.values()) {
      if (entry.expiresAtMs !== null && nowMs >= entry.expiresAtMs) this.remove(entry.note.id);
    }
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
      opacity: expiresAtMs === null ? 1 : Math.min(1, Math.max(0, (expiresAtMs - nowMs) / FADE_MS)),
    }));
  }

  private clearSpotFor(note: Note, drift: Drift, minY?: number): Note {
    const wanted = this.scriptFor(note, this.seed + 1).bounds;
    const taken = [...this.entries.values()].map((entry) => entry.script.bounds);
    const settled = settle(wanted, taken, drift, minY);
    const position = {
      x: note.position.x + settled.x - wanted.x,
      y: note.position.y + settled.y - wanted.y,
    };
    return { ...note, position };
  }

  private scriptFor(note: Note, seed: number): PenScript {
    return this.handwriting.write(note.text, {
      origin: note.position,
      ...NOTE_STYLE[note.author],
      seed,
    });
  }

  private inscribe(
    note: Note,
    writtenAtMs: number,
    anchor: NoteAnchor | null,
    lifetimeMs?: number,
  ): Entry {
    this.seed += 1;
    const script = this.scriptFor(note, this.seed);
    const expiresAtMs =
      lifetimeMs === undefined ? null : writtenAtMs + script.durationMs + lifetimeMs;
    const entry = { note, script, writtenAtMs, expiresAtMs, anchor };
    this.entries.set(note.id, entry);
    return entry;
  }
}
