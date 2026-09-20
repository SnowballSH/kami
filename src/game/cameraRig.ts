import { clamp, type Rect, rectCenter, type Vec } from "../core/geometry";
import type { Camera } from "../render/types";

const ZOOM_RANGE = { min: 0.25, max: 4 } as const;
const DEAD_ZONE = { x: 0.22, y: 0.2 } as const;
const FOLLOW_EASE = 0.12;
const FRAMING_WIDTH = 1100;
const FRAMING_ZOOM = { min: 0.5, max: 1.25 } as const;
const HEADROOM = 170;
const HALF_TURN_DEGREES = 180;
/** How far the frame leans from its subject toward company standing within half a screen of her. */
const COMPANY_LEAN = 0.3;
const COMPANY_REACH = 0.5;

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export const framingZoom = (viewport: Viewport): number =>
  clamp(viewport.width / FRAMING_WIDTH, FRAMING_ZOOM.min, FRAMING_ZOOM.max);

type ToWorld = (client: Vec, camera: Camera) => Vec;

const leanToward = (subject: Vec, company: readonly Vec[], reach: number): Vec => {
  const near = company.filter(
    (other) => Math.abs(other.x - subject.x) <= reach && Math.abs(other.y - subject.y) <= reach,
  );
  if (near.length === 0) return subject;
  const mean = {
    x: near.reduce((sum, other) => sum + other.x, 0) / near.length,
    y: near.reduce((sum, other) => sum + other.y, 0) / near.length,
  };
  return {
    x: subject.x + (mean.x - subject.x) * COMPANY_LEAN,
    y: subject.y + (mean.y - subject.y) * COMPANY_LEAN,
  };
};

/** The window onto the endless board. Follows Alice until the player takes the camera. */
export class CameraRig {
  private current: Camera = { center: { x: 0, y: 0 }, zoom: 1, angle: 0 };
  private following = true;
  private pinned = false;

  get camera(): Camera {
    return this.current;
  }

  frame(subjectFeet: Vec, viewport: Viewport): void {
    const zoom = framingZoom(viewport);
    const { angle } = this.current;
    this.current = { center: { x: subjectFeet.x, y: subjectFeet.y - HEADROOM }, zoom, angle };
    this.following = true;
    this.pinned = false;
  }

  pin(center: Vec, zoom: number): void {
    this.current = { ...this.current, center, zoom };
    this.pinned = true;
  }

  /** The paper turns about the camera's centre; the sim owns how far. */
  turnTo(angle: number): void {
    if (angle !== this.current.angle) this.current = { ...this.current, angle };
  }

  panBy(deltaClient: Vec): void {
    const { center, zoom } = this.current;
    const turn = -(this.current.angle * Math.PI) / HALF_TURN_DEGREES;
    const onPaper = {
      x: deltaClient.x * Math.cos(turn) - deltaClient.y * Math.sin(turn),
      y: deltaClient.x * Math.sin(turn) + deltaClient.y * Math.cos(turn),
    };
    this.current = {
      ...this.current,
      center: { x: center.x - onPaper.x / zoom, y: center.y - onPaper.y / zoom },
    };
    this.following = false;
  }

  /** Zooms so the world point under `client` stays under it. */
  zoomAt(client: Vec, factor: number, toWorld: ToWorld): void {
    const before = toWorld(client, this.current);
    const zoomed = {
      ...this.current,
      zoom: clamp(this.current.zoom * factor, ZOOM_RANGE.min, ZOOM_RANGE.max),
    };
    const after = toWorld(client, zoomed);
    this.current = {
      ...zoomed,
      center: {
        x: zoomed.center.x + before.x - after.x,
        y: zoomed.center.y + before.y - after.y,
      },
    };
    this.following = false;
  }

  resumeFollowing(): void {
    if (this.pinned) return;
    this.following = true;
  }

  /** Keeps `subject` in frame, leaning gently toward any `company` close enough to share it. */
  follow(subject: Rect, viewport: Viewport, company: readonly Rect[] = []): void {
    if (this.pinned || !this.following) return;
    const { center, zoom, angle } = this.current;
    const target = leanToward(
      rectCenter(subject),
      company.map(rectCenter),
      (viewport.width * COMPANY_REACH) / zoom,
    );
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
      angle,
    };
  }
}
