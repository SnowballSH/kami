import type { SceneInk } from "../autopilot/types";
import type { Ruling } from "../cat/types";
import { drawingInMotion, type InkMotion, stillMoving } from "../ink/retrace";
import type { Drawing, DrawingId, InkProvenance, PosedDrawing } from "../ink/types";
import type { StoredDrawing } from "../persistence/types";
import type { InkView } from "../render/types";
import type { DrawingPose } from "../sim/types";

export interface InkRecord extends StoredDrawing {
  readonly provenance: InkProvenance;
  /** The strokes as they landed: what the sim built its body from, and what every tidying starts from. */
  readonly drawn: Drawing["strokes"];
  readonly awakenedAtMs: number | null;
  /** Set while the ink is still coming into the strokes `drawing` already holds: Kami inking it, or a tidy. */
  readonly motion: InkMotion | null;
}

const FRESH = { ruling: null, awakenedAtMs: null, motion: null } as const;

/** What is saved of a record: provenance only when it is not the default, so drawn ink stores as before. */
export const storedOf = ({ drawing, ruling, provenance }: InkRecord): StoredDrawing =>
  provenance === "drawn" ? { drawing, ruling } : { drawing, ruling, provenance };

/** Everything the player has drawn on the current board that is still there. */
export class InkLedger {
  private readonly records = new Map<DrawingId, InkRecord>();

  add(drawing: Drawing, provenance: InkProvenance = "drawn"): void {
    this.records.set(drawing.id, { ...FRESH, drawing, drawn: drawing.strokes, provenance });
  }

  /** A drawing Kami made himself: it is all there at once, but is shown being inked from `atMs`. */
  conjure(drawing: Drawing, atMs: number, provenance: InkProvenance = "drawn"): InkRecord {
    const record: InkRecord = {
      ...FRESH,
      drawing,
      drawn: drawing.strokes,
      provenance,
      motion: { kind: "arrival", startedAtMs: atMs },
    };
    this.records.set(drawing.id, record);
    return record;
  }

  awaken(id: DrawingId, ruling: Ruling, atMs: number): InkRecord | null {
    const record = this.records.get(id);
    if (record === undefined) return null;
    const awake = { ...record, ruling, awakenedAtMs: atMs };
    this.records.set(id, awake);
    return awake;
  }

  /** The same drawing with tidied strokes; what is shown glides there from the old ones, or keeps being inked in if Kami is still at it. */
  retrace(id: DrawingId, strokes: Drawing["strokes"], atMs: number): InkRecord | null {
    const record = this.records.get(id);
    if (record === undefined) return null;
    const retraced: InkRecord = {
      ...record,
      drawing: { ...record.drawing, strokes },
      motion:
        record.motion?.kind === "arrival" && stillMoving(record.motion, atMs)
          ? record.motion
          : { kind: "retrace", from: record.drawing.strokes, startedAtMs: atMs },
    };
    this.records.set(id, retraced);
    return retraced;
  }

  /** The drawings that have a name, oldest first. */
  named(): readonly InkRecord[] {
    return [...this.records.values()].filter(({ ruling }) => ruling !== null);
  }

  ids(): readonly DrawingId[] {
    return [...this.records.keys()];
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
    return this.join(poses, (record, pose, lit) => ({
      ...drawingInMotion(record.drawing, record.motion, nowMs),
      pose,
      nature: record.ruling?.nature ?? "ink",
      lit,
      awakenedAtMs: record.awakenedAtMs,
    }));
  }

  /** What Alice can stand on: the strokes the sim built its body from, not the tidied ones shown. */
  sceneInks(poses: readonly DrawingPose[]): readonly SceneInk[] {
    return this.join(poses, ({ drawing, ruling, drawn }, pose) => ({
      drawing: drawing.strokes === drawn ? drawing : { ...drawing, strokes: drawn },
      pose,
      nature: ruling?.nature ?? "ink",
      strength: ruling?.strength ?? 1,
    }));
  }

  private join<T>(
    poses: readonly DrawingPose[],
    combine: (record: InkRecord, pose: DrawingPose["pose"], lit: boolean) => T,
  ): readonly T[] {
    return poses.flatMap(({ id, pose, lit }) => {
      const record = this.records.get(id);
      return record === undefined ? [] : [combine(record, pose, lit)];
    });
  }
}
