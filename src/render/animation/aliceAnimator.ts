import type { DrawingId } from "../../ink/types";
import { RESIZE_MS, WALK_SPEED } from "../../sim/constants";
import type { AliceSnapshot, Gait } from "../../sim/types";
import { ALICE_POSES, alicePoseName } from "../alicePose";
import {
  type AliceFigure,
  copyPose,
  type Ghost,
  type MutablePose,
  mixPose,
  newFigure,
  newPose,
} from "./aliceFigure";
import {
  arc,
  easeInCubic,
  easeInOutSine,
  easeOutBack,
  easeOutCubic,
  lerp,
  progressOf,
} from "./easing";

/** What the simulation reported about her this frame that her position alone would not show. */
export interface AliceCues {
  /** She stepped through a portal: she pops out of the far one. */
  readonly warped: boolean;
  readonly warp?: {
    readonly from: { x: number; y: number };
    readonly to: { x: number; y: number };
  };
  /** The Sumikui swallowed her: she has already faded, so nothing is left behind to drip. */
  readonly devoured: boolean;
}

export const NO_CUES: AliceCues = { warped: false, devoured: false };

export const HOP_MS = 250;
export const DISMOUNT_MS = 220;
export const LAND_MS = 150;
export const TURN_MS = 120;
export const SWELL_MS = RESIZE_MS;
export const POP_MS = 220;
export const PORTAL_ENTRY_MS = 180;
export const REINK_MS = 350;
export const DRIP_MS = 300;
export const KEY_MS = 350;
export const SEAT_SINK = 0.3;

/** Fractions of her height. */
const MOUNT_HOP = 0.35;
const DISMOUNT_HOP = 0.2;
const FLIER_BOB = 0.03;
const DRIP_LENGTH = 0.6;

/** Moving further than this in one frame (or four of her heights) is not walking: she was carried off. */
const TELEPORT_MIN_PX = 200;
const TELEPORT_HEIGHTS = 4;

/** Landing squash per px/tick of impact speed, and its limits. */
const SQUASH_PER_SPEED = 0.03;
const SOFT_LANDING_SPEED = 1.5;
export const MAX_SQUASH = 0.35;
const DISMOUNT_SQUASH = 0.12;
const CROUCH_WEIGHT = 0.8;

const TURN_LEAN = 0.18;
const MIN_FACING = 0.08;
const SWELL = 0.12;
const POP_FROM = 0.2;

const WALKER_SWAY = 0.06;
const WALKER_SWAY_RATE = 0.012;
const HOPPER_STRETCH_PER_SPEED = 0.04;
const HOPPER_STRETCH_LIMIT = 0.15;
const HOPPER_CROUCH_PER_SPEED = 0.15;
const HOPPER_CROUCH_LIMIT = 0.6;
const FLIER_FLAP_RATE = 0.014;
const VEHICLE_LEAN_PER_SPEED = 0.012;
const VEHICLE_LEAN_LIMIT = 0.1;

type HopKind = "mount" | "dismount";
type ArrivalKind = "pop" | "reink";

const clampAbs = (value: number, limit: number): number => Math.max(-limit, Math.min(limit, value));

const rideIdOf = (alice: AliceSnapshot): DrawingId | null => alice.ride?.id ?? null;

/**
 * Watches one Alice's snapshots frame after frame and turns each change of state into a short beat:
 * a hop into the seat, a squash on landing, a flip when she turns, ink running out where she was.
 * Nothing here moves her; it only decides how the picture of her catches up with the physics.
 */
export class AliceAnimator {
  private readonly figure = newFigure();
  private readonly hopFrom: MutablePose = newPose();
  private readonly ghost: Ghost = {
    center: { x: 0, y: 0 },
    alpha: 0,
    drip: 0,
    facing: 1,
    width: 0,
    height: 0,
  };
  private seen = false;
  private wasGrounded = true;
  private rideId: DrawingId | null = null;
  private facing: -1 | 1 = 1;
  private headingScale = 1;
  private hadKey = false;
  private lastX = 0;
  private lastY = 0;
  private lastFallSpeed = 0;
  private lastHeight = 0;

  private hopAtMs: number | null = null;
  private hopKind: HopKind = "mount";
  private landAtMs: number | null = null;
  private landSquash = 0;
  private turnAtMs: number | null = null;
  private turnFrom: -1 | 1 = 1;
  private swellAtMs: number | null = null;
  private swellDirection = 1;
  private arrivalAtMs: number | null = null;
  private arrivalKind: ArrivalKind = "reink";
  private ghostAtMs: number | null = null;
  private keyAtMs: number | null = null;
  private portalAtMs: number | null = null;
  private portalFrom = { x: 0, y: 0 };
  private portalTo = { x: 0, y: 0 };

  observe(alice: AliceSnapshot, cues: AliceCues, nowMs: number): AliceFigure {
    if (this.seen) this.noticeChanges(alice, cues, nowMs);
    else this.arrive("reink", nowMs);
    this.seen = true;
    this.compose(alice, nowMs);
    this.remember(alice);
    return this.figure;
  }

  private noticeChanges(alice: AliceSnapshot, cues: AliceCues, nowMs: number): void {
    const carriedOff =
      cues.warped ||
      cues.devoured ||
      Math.hypot(alice.center.x - this.lastX, alice.center.y - this.lastY) >
        Math.max(TELEPORT_MIN_PX, TELEPORT_HEIGHTS * Math.max(alice.height, this.lastHeight));
    if (carriedOff) {
      if (cues.warp !== undefined) this.startPortal(cues.warp, nowMs);
      else this.arrive(cues.warped ? "pop" : "reink", nowMs);
      if (!cues.devoured && !cues.warped) this.leaveGhost(alice, nowMs);
      return;
    }
    const rideId = rideIdOf(alice);
    if (rideId !== this.rideId) {
      this.hopAtMs = nowMs;
      this.hopKind = rideId === null ? "dismount" : "mount";
      copyPose(this.hopFrom, this.figure.pose);
      if (rideId === null) {
        this.landAtMs = nowMs + DISMOUNT_MS;
        this.landSquash = DISMOUNT_SQUASH;
      }
    } else if (alice.grounded && !this.wasGrounded && alice.ride === null) {
      if (this.lastFallSpeed > SOFT_LANDING_SPEED) {
        this.landAtMs = nowMs;
        this.landSquash = Math.min(MAX_SQUASH, this.lastFallSpeed * SQUASH_PER_SPEED);
      }
    }
    if (alice.facing !== this.facing) {
      this.turnAtMs = nowMs;
      this.turnFrom = this.facing;
    }
    if (alice.headingScale !== this.headingScale) {
      this.swellAtMs = nowMs;
      this.swellDirection = Math.sign(alice.headingScale - this.headingScale);
    }
    if (alice.hasKey && !this.hadKey) this.keyAtMs = nowMs;
  }

  private arrive(kind: ArrivalKind, nowMs: number): void {
    this.arrivalAtMs = nowMs;
    this.arrivalKind = kind;
    this.hopAtMs = null;
    this.landAtMs = null;
    this.turnAtMs = null;
    this.portalAtMs = null;
  }

  private startPortal(warp: NonNullable<AliceCues["warp"]>, nowMs: number): void {
    this.portalAtMs = nowMs;
    this.portalFrom = { ...warp.from };
    this.portalTo = { ...warp.to };
    this.arrivalAtMs = null;
    this.hopAtMs = null;
    this.landAtMs = null;
    this.turnAtMs = null;
  }

  private leaveGhost(alice: AliceSnapshot, nowMs: number): void {
    const { ghost } = this;
    ghost.center.x = this.lastX;
    ghost.center.y = this.lastY;
    ghost.facing = this.figure.facing;
    ghost.width = alice.width;
    ghost.height = this.lastHeight;
    this.ghostAtMs = nowMs;
  }

  private compose(alice: AliceSnapshot, nowMs: number): void {
    const { figure } = this;
    figure.offset.x = 0;
    figure.offset.y = 0;
    figure.stretch.x = 1;
    figure.stretch.y = 1;
    figure.facing = alice.facing;
    figure.lean = 0;
    figure.alpha = 1;
    figure.inked = 1;
    figure.keyScale = 1;
    figure.ghost = null;
    copyPose(figure.pose, ALICE_POSES[alicePoseName(alice, nowMs)]);
    this.composeHop(alice, nowMs);
    if (alice.ride !== null) this.composeRide(alice, alice.ride.gait, nowMs);
    this.composeLanding(nowMs);
    this.composeTurn(alice, nowMs);
    this.composeSwell(nowMs);
    this.composeArrival(nowMs);
    this.composePortal(alice, nowMs);
    this.composeGhost(nowMs);
    this.composeKey(nowMs);
  }

  private composeHop(alice: AliceSnapshot, nowMs: number): void {
    if (this.hopAtMs === null) return;
    const mounting = this.hopKind === "mount";
    const t = progressOf(nowMs, this.hopAtMs, mounting ? HOP_MS : DISMOUNT_MS);
    if (t >= 1) {
      this.hopAtMs = null;
      return;
    }
    const { figure } = this;
    mixPose(figure.pose, this.hopFrom, figure.pose, easeInOutSine(t));
    figure.offset.y -= (mounting ? MOUNT_HOP : DISMOUNT_HOP) * alice.height * arc(t);
  }

  private composeRide(alice: AliceSnapshot, gait: Gait, nowMs: number): void {
    const { figure } = this;
    const { velocity } = alice;
    switch (gait) {
      case "walker": {
        const stride = Math.min(1, Math.abs(velocity.x) / WALK_SPEED);
        figure.lean += WALKER_SWAY * stride * Math.sin(nowMs * WALKER_SWAY_RATE);
        return;
      }
      case "hopper": {
        const stretch = clampAbs(-velocity.y * HOPPER_STRETCH_PER_SPEED, HOPPER_STRETCH_LIMIT);
        figure.stretch.y *= 1 + stretch;
        figure.stretch.x *= 1 - stretch;
        const crouch = Math.min(
          HOPPER_CROUCH_LIMIT,
          Math.max(0, velocity.y) * HOPPER_CROUCH_PER_SPEED,
        );
        if (crouch > 0) mixPose(figure.pose, figure.pose, ALICE_POSES.crouch, crouch);
        return;
      }
      case "flier":
        figure.offset.y += FLIER_BOB * alice.height * Math.sin(nowMs * FLIER_FLAP_RATE);
        return;
      case "vehicle":
        figure.offset.y += SEAT_SINK * alice.height;
        figure.lean -= clampAbs(velocity.x * VEHICLE_LEAN_PER_SPEED, VEHICLE_LEAN_LIMIT);
        return;
    }
  }

  private composeLanding(nowMs: number): void {
    if (this.landAtMs === null || nowMs < this.landAtMs) return;
    const t = progressOf(nowMs, this.landAtMs, LAND_MS);
    if (t >= 1) {
      this.landAtMs = null;
      return;
    }
    const squash = this.landSquash * (1 - easeOutCubic(t));
    const { figure } = this;
    figure.stretch.y *= 1 - squash;
    figure.stretch.x *= 1 + squash;
    mixPose(figure.pose, figure.pose, ALICE_POSES.crouch, (squash / MAX_SQUASH) * CROUCH_WEIGHT);
  }

  private composeTurn(alice: AliceSnapshot, nowMs: number): void {
    if (this.turnAtMs === null) return;
    const t = progressOf(nowMs, this.turnAtMs, TURN_MS);
    if (t >= 1) {
      this.turnAtMs = null;
      return;
    }
    const { figure } = this;
    const facing = lerp(this.turnFrom, alice.facing, easeInOutSine(t));
    figure.facing =
      Math.abs(facing) >= MIN_FACING
        ? facing
        : MIN_FACING * (t < 0.5 ? this.turnFrom : alice.facing);
    figure.lean += TURN_LEAN * arc(t) * alice.facing;
  }

  private composeSwell(nowMs: number): void {
    if (this.swellAtMs === null) return;
    const t = progressOf(nowMs, this.swellAtMs, SWELL_MS);
    if (t >= 1) {
      this.swellAtMs = null;
      return;
    }
    const bulge = this.swellDirection * SWELL * arc(t);
    this.figure.stretch.x *= 1 + bulge;
    this.figure.stretch.y *= 1 - bulge;
  }

  private composeArrival(nowMs: number): void {
    if (this.arrivalAtMs === null) return;
    const popping = this.arrivalKind === "pop";
    const t = progressOf(nowMs, this.arrivalAtMs, popping ? POP_MS : REINK_MS);
    if (t >= 1) {
      this.arrivalAtMs = null;
      return;
    }
    const { figure } = this;
    if (popping) {
      const scale = lerp(POP_FROM, 1, easeOutBack(t));
      figure.stretch.x *= scale;
      figure.stretch.y *= scale;
    } else {
      figure.inked = t;
    }
  }

  private composePortal(alice: AliceSnapshot, nowMs: number): void {
    if (this.portalAtMs === null) return;
    const elapsed = nowMs - this.portalAtMs;
    const { figure } = this;
    if (elapsed < PORTAL_ENTRY_MS) {
      const t = progressOf(nowMs, this.portalAtMs, PORTAL_ENTRY_MS);
      const approach = easeInOutSine(t);
      figure.offset.x = lerp(this.lastX, this.portalFrom.x, approach) - alice.center.x;
      figure.offset.y = lerp(this.lastY, this.portalFrom.y, approach) - alice.center.y;
      const scale = lerp(1, POP_FROM, easeInCubic(t));
      figure.stretch.x *= scale;
      figure.stretch.y *= scale;
      figure.lean = Math.PI * 2 * t;
      return;
    }
    const t = progressOf(nowMs, this.portalAtMs + PORTAL_ENTRY_MS, POP_MS);
    if (t >= 1) {
      this.portalAtMs = null;
      return;
    }
    figure.offset.x = this.portalTo.x - alice.center.x;
    figure.offset.y = this.portalTo.y - alice.center.y;
    const scale = lerp(POP_FROM, 1.1, easeOutBack(t));
    figure.stretch.x *= scale;
    figure.stretch.y *= scale;
    figure.lean = Math.PI * 2 * (1 - t);
  }

  private composeGhost(nowMs: number): void {
    if (this.ghostAtMs === null) return;
    const t = progressOf(nowMs, this.ghostAtMs, DRIP_MS);
    if (t >= 1) {
      this.ghostAtMs = null;
      return;
    }
    this.ghost.alpha = 1 - t;
    this.ghost.drip = DRIP_LENGTH * easeInCubic(t);
    this.figure.ghost = this.ghost;
  }

  private composeKey(nowMs: number): void {
    if (this.keyAtMs === null) return;
    const t = progressOf(nowMs, this.keyAtMs, KEY_MS);
    if (t >= 1) {
      this.keyAtMs = null;
      return;
    }
    this.figure.keyScale = easeOutBack(t);
  }

  private remember(alice: AliceSnapshot): void {
    this.wasGrounded = alice.grounded;
    this.rideId = rideIdOf(alice);
    this.facing = alice.facing;
    this.headingScale = alice.headingScale;
    this.hadKey = alice.hasKey;
    this.lastX = alice.center.x;
    this.lastY = alice.center.y;
    this.lastFallSpeed = alice.velocity.y;
    this.lastHeight = alice.height;
  }
}
