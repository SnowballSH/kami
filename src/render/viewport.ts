import { clamp, type Rect, rectCenter, type Vec } from "../core/geometry";
import { WORLD } from "../core/world";

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Viewport {
  readonly scale: number;
  readonly offset: Vec;
}

export interface FitOptions {
  readonly padding?: number;
  readonly maxScale?: number;
}

export interface DeviceTransform {
  readonly scale: number;
  readonly dx: number;
  readonly dy: number;
}

export const MAX_PIXEL_RATIO = 2;

const MIN_SCALE = 1e-3;
const MIN_EXTENT = 1;
const WORLD_RECT: Rect = { x: 0, y: 0, ...WORLD };

export const fitRect = (
  content: Rect,
  box: Size,
  { padding = 0, maxScale = Number.POSITIVE_INFINITY }: FitOptions = {},
): Viewport => {
  const room = Math.min(
    (box.width - padding * 2) / Math.max(content.width, MIN_EXTENT),
    (box.height - padding * 2) / Math.max(content.height, MIN_EXTENT),
  );
  const scale = clamp(room, MIN_SCALE, maxScale);
  const center = rectCenter(content);
  return {
    scale,
    offset: { x: box.width / 2 - center.x * scale, y: box.height / 2 - center.y * scale },
  };
};

export const fitViewport = (box: Size): Viewport => fitRect(WORLD_RECT, box);

export const toWorld = (viewport: Viewport, screen: Vec): Vec => ({
  x: (screen.x - viewport.offset.x) / viewport.scale,
  y: (screen.y - viewport.offset.y) / viewport.scale,
});

export const toScreen = (viewport: Viewport, world: Vec): Vec => ({
  x: world.x * viewport.scale + viewport.offset.x,
  y: world.y * viewport.scale + viewport.offset.y,
});

export const cappedPixelRatio = (deviceRatio: number | undefined): number =>
  deviceRatio === undefined || !Number.isFinite(deviceRatio)
    ? 1
    : clamp(deviceRatio, 1, MAX_PIXEL_RATIO);

export const backingStoreSize = (box: Size, pixelRatio: number): Size => ({
  width: Math.max(1, Math.round(box.width * pixelRatio)),
  height: Math.max(1, Math.round(box.height * pixelRatio)),
});

export const deviceTransform = (viewport: Viewport, pixelRatio: number): DeviceTransform => ({
  scale: viewport.scale * pixelRatio,
  dx: Math.round(viewport.offset.x * pixelRatio),
  dy: Math.round(viewport.offset.y * pixelRatio),
});
