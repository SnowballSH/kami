import { clamp, type Rect } from "../core/geometry";
import type { Handwriting, PenScript } from "../handwriting/types";
import type { NoteId } from "../notes/types";
import { rectInView } from "./culling";
import { appendStroke, NOTE_PEN, NOTE_THICKNESS, strokesPath } from "./inkPath";
import { noteCss } from "./palette";
import type { NoteView } from "./types";

interface WrittenNote {
  readonly script: PenScript;
  readonly path: Path2D;
  settledStrokes: number;
}

const CULL_MARGIN = NOTE_THICKNESS * 4;
const UNDERLINE = { gap: 5, width: NOTE_THICKNESS * 0.7 } as const;

export const writingProgress = (script: PenScript, elapsedMs: number): number =>
  script.durationMs <= 0 ? 1 : clamp(elapsedMs / script.durationMs, 0, 1);

export const settledStrokeCount = (script: PenScript, elapsedMs: number, from: number): number => {
  let settled = from;
  while (settled < script.strokes.length && (script.endsAtMs[settled] ?? 0) <= elapsedMs) settled++;
  return settled;
};

const isRewound = ({ script, settledStrokes }: WrittenNote, elapsedMs: number): boolean =>
  (script.endsAtMs[settledStrokes - 1] ?? Number.NEGATIVE_INFINITY) > elapsedMs;

export class NotePainter {
  private readonly written = new Map<NoteId, WrittenNote>();

  constructor(private readonly handwriting: Handwriting) {}

  forget(): void {
    this.written.clear();
  }

  paintNotes(
    ctx: CanvasRenderingContext2D,
    notes: readonly NoteView[],
    view: Rect,
    nowMs: number,
    daylight = 1,
  ): void {
    ctx.save();
    ctx.lineCap = "round";
    for (const note of notes) {
      if (note.opacity > 0 && rectInView(note.script.bounds, view, CULL_MARGIN)) {
        this.paintNote(ctx, note, nowMs - note.writtenAtMs, daylight);
      }
    }
    ctx.restore();
    if (this.written.size > notes.length) this.prune(notes);
  }

  private paintNote(
    ctx: CanvasRenderingContext2D,
    note: NoteView,
    elapsedMs: number,
    daylight: number,
  ): void {
    const { script } = note;
    const written = this.writtenNote(note, elapsedMs);
    const color = noteCss(note.author, note.tone, daylight);
    ctx.globalAlpha = clamp(note.opacity, 0, 1);
    ctx.fillStyle = color;
    this.settle(written, elapsedMs);
    ctx.fill(written.path);
    if (written.settledStrokes < script.strokes.length) {
      const revealed = this.handwriting.reveal(script, elapsedMs);
      ctx.fill(strokesPath(revealed.slice(written.settledStrokes), NOTE_PEN));
    }
    if (note.tappable) this.underline(ctx, script, color, writingProgress(script, elapsedMs));
  }

  private settle(written: WrittenNote, elapsedMs: number): void {
    const settled = settledStrokeCount(written.script, elapsedMs, written.settledStrokes);
    for (let index = written.settledStrokes; index < settled; index++) {
      const stroke = written.script.strokes[index];
      if (stroke !== undefined) appendStroke(written.path, stroke, NOTE_PEN);
    }
    written.settledStrokes = settled;
  }

  private underline(
    ctx: CanvasRenderingContext2D,
    { bounds }: PenScript,
    color: string,
    progress: number,
  ): void {
    if (progress <= 0) return;
    const y = bounds.y + bounds.height + UNDERLINE.gap;
    ctx.beginPath();
    ctx.moveTo(bounds.x, y);
    ctx.lineTo(bounds.x + bounds.width * progress, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = UNDERLINE.width;
    ctx.stroke();
  }

  private writtenNote(note: NoteView, elapsedMs: number): WrittenNote {
    const cached = this.written.get(note.id);
    if (cached?.script === note.script && !isRewound(cached, elapsedMs)) return cached;
    const written: WrittenNote = { script: note.script, path: new Path2D(), settledStrokes: 0 };
    this.written.set(note.id, written);
    return written;
  }

  private prune(notes: readonly NoteView[]): void {
    const alive = new Set(notes.map((note) => note.id));
    for (const id of this.written.keys()) {
      if (!alive.has(id)) this.written.delete(id);
    }
  }
}
