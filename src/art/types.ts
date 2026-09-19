import type { Nature, SketchSource } from "../cat/types";
import type { Drawing } from "../ink/types";
import type { DrawingArt } from "../render/types";

export interface ArtRequest {
  readonly drawing: Drawing;
  /** What the player called it; plain ink is never illustrated. */
  readonly name: string;
  readonly nature: Nature;
  readonly sketch: SketchSource;
}

/**
 * Turns a named drawing into a picture. Implementations may take seconds and may fail; the
 * ink keeps rendering until (and unless) art arrives. Physics never depends on this.
 */
export interface ArtProvider {
  illustrate(request: ArtRequest, signal: AbortSignal): Promise<DrawingArt | null>;
}
