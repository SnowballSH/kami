import type { Camera } from "../render/types";
import type { Viewport } from "./wire";

/** The source's camera for a canvas of another size: the same centre, and all of what the source sees. */
export const fittedCamera = (camera: Camera, from: Viewport, to: Viewport): Camera => {
  if (from.width <= 0 || from.height <= 0) return camera;
  const scale = Math.min(to.width / from.width, to.height / from.height);
  return scale > 0 ? { ...camera, zoom: camera.zoom * scale } : camera;
};
