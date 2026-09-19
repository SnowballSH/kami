import { distanceToRect, type Pose, poseToWorld, type Rect, rectCenter } from "../core/geometry";

export const rectInView = (bounds: Rect, view: Rect, margin: number): boolean =>
  bounds.x - margin < view.x + view.width &&
  view.x < bounds.x + bounds.width + margin &&
  bounds.y - margin < view.y + view.height &&
  view.y < bounds.y + bounds.height + margin;

export const posedInView = (drawnBounds: Rect, pose: Pose, view: Rect, margin: number): boolean => {
  const reach = Math.hypot(drawnBounds.width, drawnBounds.height) / 2 + margin;
  return distanceToRect(poseToWorld(rectCenter(drawnBounds), pose), view) <= reach;
};
