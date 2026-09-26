import type { Drawing, DrawingId } from "../ink/types";
import type { HeldInkView } from "../render/types";

export const HELD_INK_FADE_MS = 450;

interface Held {
  readonly drawing: Drawing;
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

  hold(drawing: Drawing): void {
    this.held.set(drawing.id, { drawing, fadingSinceMs: null });
  }

  /** Whether this ink is still hanging here waiting on its reading, neither faded nor taken back. */
  isReading(id: DrawingId): boolean {
    return this.held.get(id)?.fadingSinceMs === null;
  }

  /** Drops this ink if it is still being read, so its reading comes to nothing. */
  retract(id: DrawingId): boolean {
    if (!this.isReading(id)) return false;
    this.held.delete(id);
    return true;
  }

  release(id: DrawingId): void {
    this.held.delete(id);
  }

  fade(drawing: Drawing, nowMs: number): void {
    this.held.set(drawing.id, { drawing, fadingSinceMs: nowMs });
  }

  clear(): void {
    this.held.clear();
  }

  views(nowMs: number): readonly HeldInkView[] {
    const views: HeldInkView[] = [];
    for (const [id, { drawing, fadingSinceMs }] of this.held) {
      const opacity = fadingSinceMs === null ? 1 : 1 - (nowMs - fadingSinceMs) / HELD_INK_FADE_MS;
      if (opacity <= 0) this.held.delete(id);
      else views.push({ strokes: drawing.strokes, opacity });
    }
    return views;
  }
}
