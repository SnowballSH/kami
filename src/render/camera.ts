import { clamp, type Rect, type Vec } from "../core/geometry";
import type { Camera } from "./types";

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** The canvas matrix that takes world px to device px: world → turn → scale → shift. */
export interface DeviceTransform {
  readonly scale: number;
  /** Radians, clockwise on screen. */
  readonly turn: number;
  readonly dx: number;
  readonly dy: number;
}

export const MAX_PIXEL_RATIO = 2;

const MIN_ZOOM = 1e-3;
const FALLBACK_ZOOM = 1;
const HALF_TURN_DEGREES = 180;

export const zoomOf = (camera: Camera): number =>
  Number.isFinite(camera.zoom) ? Math.max(camera.zoom, MIN_ZOOM) : FALLBACK_ZOOM;

export const turnOf = (camera: Camera): number =>
  Number.isFinite(camera.angle) ? (camera.angle * Math.PI) / HALF_TURN_DEGREES : 0;

const turned = ({ x, y }: Vec, radians: number): Vec => {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
};

export const toWorld = (client: Vec, camera: Camera, box: Size): Vec => {
  const zoom = zoomOf(camera);
  const offset = turned(
    { x: (client.x - box.width / 2) / zoom, y: (client.y - box.height / 2) / zoom },
    -turnOf(camera),
  );
  return { x: camera.center.x + offset.x, y: camera.center.y + offset.y };
};

export const toClient = (world: Vec, camera: Camera, box: Size): Vec => {
  const zoom = zoomOf(camera);
  const offset = turned(
    { x: world.x - camera.center.x, y: world.y - camera.center.y },
    turnOf(camera),
  );
  return { x: offset.x * zoom + box.width / 2, y: offset.y * zoom + box.height / 2 };
};

/** The world rectangle that covers the canvas: the turned viewport's bounding box. */
export const visibleWorld = (camera: Camera, box: Size): Rect => {
  const zoom = zoomOf(camera);
  const turn = turnOf(camera);
  const cos = Math.abs(Math.cos(turn));
  const sin = Math.abs(Math.sin(turn));
  const width = (box.width * cos + box.height * sin) / zoom;
  const height = (box.width * sin + box.height * cos) / zoom;
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
  const turn = turnOf(camera);
  const centerOnScreen = turned(camera.center, turn);
  return {
    scale: zoom * pixelRatio,
    turn,
    dx: (box.width / 2 - centerOnScreen.x * zoom) * pixelRatio,
    dy: (box.height / 2 - centerOnScreen.y * zoom) * pixelRatio,
  };
};

export const applyDeviceTransform = (
  ctx: CanvasRenderingContext2D,
  { scale, turn, dx, dy }: DeviceTransform,
): void => {
  const cos = Math.cos(turn) * scale;
  const sin = Math.sin(turn) * scale;
  ctx.setTransform(cos, sin, -sin, cos, dx, dy);
};
