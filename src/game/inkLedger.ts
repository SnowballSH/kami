import type { Ruling } from "../cat/types";
import type { Drawing, DrawingId, PosedDrawing } from "../ink/types";
import type { InkView } from "../render/types";
import type { DrawingPose } from "../sim/types";

export interface InkRecord {
  readonly drawing: Drawing;
  readonly ruling: Ruling | null;
  readonly awakenedAtMs: number | null;
}

/** Everything the player has drawn in the current room: what is still on the page, and what Alice ate. */
export class InkLedger {
  private readonly live = new Map<DrawingId, InkRecord>();
  private readonly eaten: InkRecord[] = [];

  add(drawing: Drawing): void {
    this.live.set(drawing.id, { drawing, ruling: null, awakenedAtMs: null });
  }

  awaken(id: DrawingId, ruling: Ruling, nowMs: number): void {
    const record = this.live.get(id);
    if (record !== undefined) this.live.set(id, { ...record, ruling, awakenedAtMs: nowMs });
  }

  has(id: DrawingId): boolean {
    return this.live.has(id);
  }

  erase(id: DrawingId): InkRecord | null {
    const record = this.live.get(id) ?? null;
    this.live.delete(id);
    return record;
  }

  markEaten(id: DrawingId): void {
    const record = this.erase(id);
    if (record !== null) this.eaten.push(record);
  }

  clear(): void {
    this.live.clear();
    this.eaten.length = 0;
  }

  everything(): readonly InkRecord[] {
    return [...this.eaten, ...this.live.values()];
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

  private join<T>(
    poses: readonly DrawingPose[],
    combine: (record: InkRecord, pose: DrawingPose["pose"]) => T,
  ): readonly T[] {
    return poses.flatMap(({ id, pose }) => {
      const record = this.live.get(id);
      return record === undefined ? [] : [combine(record, pose)];
    });
  }
}
