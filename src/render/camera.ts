import { clamp, type Rect, type Vec } from "../core/geometry";
import type { Camera } from "./types";

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface DeviceTransform {
  readonly scale: number;
  readonly dx: number;
  readonly dy: number;
}

export const MAX_PIXEL_RATIO = 2;

const MIN_ZOOM = 1e-3;
const FALLBACK_ZOOM = 1;

export const zoomOf = (camera: Camera): number =>
  Number.isFinite(camera.zoom) ? Math.max(camera.zoom, MIN_ZOOM) : FALLBACK_ZOOM;

export const toWorld = (client: Vec, camera: Camera, box: Size): Vec => {
  const zoom = zoomOf(camera);
  return {
    x: camera.center.x + (client.x - box.width / 2) / zoom,
    y: camera.center.y + (client.y - box.height / 2) / zoom,
  };
};

export const toClient = (world: Vec, camera: Camera, box: Size): Vec => {
  const zoom = zoomOf(camera);
  return {
    x: (world.x - camera.center.x) * zoom + box.width / 2,
    y: (world.y - camera.center.y) * zoom + box.height / 2,
  };
};

export const visibleWorld = (camera: Camera, box: Size): Rect => {
  const zoom = zoomOf(camera);
  const width = box.width / zoom;
  const height = box.height / zoom;
  return { x: camera.center.x - width / 2, y: camera.center.y - height / 2, width, height };
};

export const cappedPixelRatio = (deviceRatio: number | undefined): number =>
  deviceRatio === undefined || !Number.isFinite(deviceRatio)
    ? 1
    : clamp(deviceRatio, 1, MAX_PIXEL_RATIO);

export const backingStoreSize = (box: Size, pixelRatio: number): Size => ({
  width: Math.max(1, Math.round(box.width * pixelRatio)),
  height: Math.max(1, Math.round(box.height * pixelRatio)),
});

export const deviceTransform = (camera: Camera, box: Size, pixelRatio: number): DeviceTransform => {
  const zoom = zoomOf(camera);
  return {
    scale: zoom * pixelRatio,
    dx: (box.width / 2 - camera.center.x * zoom) * pixelRatio,
    dy: (box.height / 2 - camera.center.y * zoom) * pixelRatio,
  };
};
