import { clamp, type Rect, rectCenter, type Vec } from "../core/geometry";
import type { Camera } from "../render/types";

const ZOOM_RANGE = { min: 0.25, max: 4 } as const;
const DEAD_ZONE = { x: 0.22, y: 0.2 } as const;
const FOLLOW_EASE = 0.12;
const FRAMING_WIDTH = 1100;
const FRAMING_ZOOM = { min: 0.5, max: 1.25 } as const;
const HEADROOM = 170;

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

type ToWorld = (client: Vec, camera: Camera) => Vec;

/** The window onto the endless board. Follows Alice until the player takes the camera. */
export class CameraRig {
  private current: Camera = { center: { x: 0, y: 0 }, zoom: 1 };
  private following = true;

  get camera(): Camera {
    return this.current;
  }

  frame(subjectFeet: Vec, viewport: Viewport): void {
    const zoom = clamp(viewport.width / FRAMING_WIDTH, FRAMING_ZOOM.min, FRAMING_ZOOM.max);
    this.current = { center: { x: subjectFeet.x, y: subjectFeet.y - HEADROOM }, zoom };
    this.following = true;
  }

  panBy(deltaClient: Vec): void {
    const { center, zoom } = this.current;
    this.current = {
      center: { x: center.x - deltaClient.x / zoom, y: center.y - deltaClient.y / zoom },
      zoom,
    };
    this.following = false;
  }

  /** Zooms so the world point under `client` stays under it. */
  zoomAt(client: Vec, factor: number, toWorld: ToWorld): void {
    const before = toWorld(client, this.current);
    const zoomed = {
      center: this.current.center,
      zoom: clamp(this.current.zoom * factor, ZOOM_RANGE.min, ZOOM_RANGE.max),
    };
    const after = toWorld(client, zoomed);
    this.current = {
      center: {
        x: zoomed.center.x + before.x - after.x,
        y: zoomed.center.y + before.y - after.y,
      },
      zoom: zoomed.zoom,
    };
    this.following = false;
  }

  resumeFollowing(): void {
    this.following = true;
  }

  follow(subject: Rect, viewport: Viewport): void {
    if (!this.following) return;
    const { center, zoom } = this.current;
    const target = rectCenter(subject);
    const slack = {
      x: (viewport.width * DEAD_ZONE.x) / zoom,
      y: (viewport.height * DEAD_ZONE.y) / zoom,
    };
    const overshoot = (offset: number, limit: number): number =>
      offset > limit ? offset - limit : offset < -limit ? offset + limit : 0;
    this.current = {
      center: {
        x: center.x + overshoot(target.x - center.x, slack.x) * FOLLOW_EASE,
        y: center.y + overshoot(target.y - center.y, slack.y) * FOLLOW_EASE,
      },
      zoom,
    };
  }
}
