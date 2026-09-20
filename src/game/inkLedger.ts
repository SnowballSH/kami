import type { SceneInk } from "../autopilot/types";
import type { Ruling } from "../cat/types";
import type { Drawing, DrawingId, PosedDrawing } from "../ink/types";
import type { StoredDrawing } from "../persistence/types";
import type { InkView } from "../render/types";
import type { DrawingPose } from "../sim/types";
import { type Retrace, retracedStrokes, retraceProgress } from "./retrace";

export interface InkRecord extends StoredDrawing {
  readonly awakenedAtMs: number | null;
  /** Set while the ink is still gliding into the tidied strokes `drawing` already holds. */
  readonly retrace: Retrace | null;
}

const shownAt = (record: InkRecord, nowMs: number): Drawing => {
  if (record.retrace === null) return record.drawing;
  const progress = retraceProgress(record.retrace, nowMs);
  if (progress >= 1) return record.drawing;
  const strokes = retracedStrokes(record.retrace.from, record.drawing.strokes, progress);
  return { ...record.drawing, strokes };
};

/** Everything the player has drawn on the current board that is still there. */
export class InkLedger {
  private readonly records = new Map<DrawingId, InkRecord>();

  add(drawing: Drawing): void {
    this.records.set(drawing.id, { drawing, ruling: null, awakenedAtMs: null, retrace: null });
  }

  awaken(id: DrawingId, ruling: Ruling, atMs: number): InkRecord | null {
    const record = this.records.get(id);
    if (record === undefined) return null;
    const awake = { ...record, ruling, awakenedAtMs: atMs };
    this.records.set(id, awake);
    return awake;
  }

  /** The same drawing with tidied strokes; what is shown glides there from the old ones. */
  retrace(id: DrawingId, strokes: Drawing["strokes"], atMs: number): InkRecord | null {
    const record = this.records.get(id);
    if (record === undefined) return null;
    const retraced: InkRecord = {
      ...record,
      drawing: { ...record.drawing, strokes },
      retrace: { from: record.drawing.strokes, startedAtMs: atMs },
    };
    this.records.set(id, retraced);
    return retraced;
  }

  get(id: DrawingId): InkRecord | null {
    return this.records.get(id) ?? null;
  }

  remove(id: DrawingId): InkRecord | null {
    const record = this.get(id);
    this.records.delete(id);
    return record;
  }

  clear(): void {
    this.records.clear();
  }

  posed(poses: readonly DrawingPose[]): readonly PosedDrawing[] {
    return this.join(poses, ({ drawing }, pose) => ({ drawing, pose }));
  }

  views(poses: readonly DrawingPose[], nowMs: number): readonly InkView[] {
    return this.join(poses, (record, pose) => ({
      drawing: shownAt(record, nowMs),
      pose,
      nature: record.ruling?.nature ?? "ink",
      awakenedAtMs: record.awakenedAtMs,
    }));
  }

  /** What Alice can stand on: the strokes the sim built its body from, not the tidied ones shown. */
  sceneInks(poses: readonly DrawingPose[]): readonly SceneInk[] {
    return this.join(poses, ({ drawing, ruling, retrace }, pose) => ({
      drawing: retrace === null ? drawing : { ...drawing, strokes: retrace.from },
      pose,
      nature: ruling?.nature ?? "ink",
      strength: ruling?.strength ?? 1,
    }));
  }

  private join<T>(
    poses: readonly DrawingPose[],
    combine: (record: InkRecord, pose: DrawingPose["pose"]) => T,
  ): readonly T[] {
    return poses.flatMap(({ id, pose }) => {
      const record = this.records.get(id);
      return record === undefined ? [] : [combine(record, pose)];
    });
  }
}
