import type { Stroke } from "../core/geometry";
import type { DrawingId } from "../ink/types";
import type { HeldInkView } from "../render/types";

export const HELD_INK_FADE_MS = 450;

interface Held {
  readonly strokes: readonly Stroke[];
  /** When the strokes turned out to be words and began to fade; null while still being read. */
  fadingSinceMs: number | null;
}

/**
 * Strokes that have settled but are still being read: they hang weightless where they were drawn
 * until the reader answers. Words fade away; a drawing is let go to land in the world.
 */
export class HeldInkBook {
  private readonly held = new Map<DrawingId, Held>();

  get isHolding(): boolean {
    for (const { fadingSinceMs } of this.held.values()) if (fadingSinceMs === null) return true;
    return false;
  }

  hold(id: DrawingId, strokes: readonly Stroke[]): void {
    this.held.set(id, { strokes, fadingSinceMs: null });
  }

  release(id: DrawingId): void {
    this.held.delete(id);
  }

  fade(id: DrawingId, strokes: readonly Stroke[], nowMs: number): void {
    this.held.set(id, { strokes, fadingSinceMs: nowMs });
  }

  clear(): void {
    this.held.clear();
  }

  views(nowMs: number): readonly HeldInkView[] {
    const views: HeldInkView[] = [];
    for (const [id, { strokes, fadingSinceMs }] of this.held) {
      const opacity = fadingSinceMs === null ? 1 : 1 - (nowMs - fadingSinceMs) / HELD_INK_FADE_MS;
      if (opacity <= 0) this.held.delete(id);
      else views.push({ strokes, opacity });
    }
    return views;
  }
}
