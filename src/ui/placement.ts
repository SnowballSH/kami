import { clamp, type Rect, type Vec } from "../core/geometry";

export interface Size {
  readonly width: number;
  readonly height: number;
}

const clampStart = (start: number, min: number, max: number): number =>
  clamp(start, min, Math.max(min, max));

/** Top-left of a box that starts at `anchor` and is centred on it vertically, kept inside `visible`. */
export const placeWithin = (anchor: Vec, size: Size, visible: Rect, margin: number): Vec => ({
  x: clampStart(anchor.x, visible.x + margin, visible.x + visible.width - size.width - margin),
  y: clampStart(
    anchor.y - size.height / 2,
    visible.y + margin,
    visible.y + visible.height - size.height - margin,
  ),
});

/** Safari shrinks only the visual viewport when the on-screen keyboard opens. */
export const visibleRect = (host: Window): Rect => {
  const viewport = host.visualViewport ?? null;
  if (viewport === null) return { x: 0, y: 0, width: host.innerWidth, height: host.innerHeight };
  return {
    x: viewport.offsetLeft,
    y: viewport.offsetTop,
    width: viewport.width,
    height: viewport.height,
  };
};
