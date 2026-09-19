import type { SceneInk } from "../autopilot/types";
import type { Ruling } from "../cat/types";
import type { Drawing, DrawingId, PosedDrawing } from "../ink/types";
import type { StoredDrawing } from "../persistence/types";
import type { InkView } from "../render/types";
import type { DrawingPose } from "../sim/types";

export interface InkRecord extends StoredDrawing {
  readonly awakenedAtMs: number | null;
}

/** Everything the player has drawn on the current board that is still there. */
export class InkLedger {
  private readonly records = new Map<DrawingId, InkRecord>();

  add(drawing: Drawing): void {
    this.records.set(drawing.id, { drawing, ruling: null, awakenedAtMs: null });
  }

  awaken(id: DrawingId, ruling: Ruling, atMs: number): InkRecord | null {
    const record = this.records.get(id);
    if (record === undefined) return null;
    const awake = { ...record, ruling, awakenedAtMs: atMs };
    this.records.set(id, awake);
    return awake;
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

  views(poses: readonly DrawingPose[]): readonly InkView[] {
    return this.join(poses, ({ drawing, ruling, awakenedAtMs }, pose) => ({
      drawing,
      pose,
      nature: ruling?.nature ?? "ink",
      awakenedAtMs,
    }));
  }

  sceneInks(poses: readonly DrawingPose[]): readonly SceneInk[] {
    return this.join(poses, ({ drawing, ruling }, pose) => ({
      drawing,
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
