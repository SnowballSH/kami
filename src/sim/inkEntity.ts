import type Matter from "matter-js";
import type { Nature } from "../cat/types";
import { type Pose, poseToWorld, type Stroke, type Vec } from "../core/geometry";
import type { Drawing, DrawingId } from "../ink/types";
import { type Motion, type MotionEdit, STILL } from "../rules/types";
import { freshMind, type Mind } from "./creatures";

export class InkEntity {
  nature: Nature = "ink";
  name = "";
  strength = 1;
  frozen = false;
  /** What its name asked for; `motion` is that under every standing law that speaks of it. */
  own: MotionEdit = {};
  motion: Motion = STILL;
  /** Excess heat soaked up so far, in °C·ms; only natures that perish in heat accumulate any. */
  warmth = 0;
  mind: Mind;

  constructor(
    readonly drawing: Drawing,
    readonly origin: Vec,
    public body: Matter.Body,
  ) {
    this.mind = freshMind(drawing.id);
  }

  get id(): DrawingId {
    return this.drawing.id;
  }

  get pose(): Pose {
    const { position, angle } = this.body;
    return { origin: this.origin, position: { x: position.x, y: position.y }, angle };
  }

  get worldStrokes(): readonly Stroke[] {
    const pose = this.pose;
    return this.drawing.strokes.map((stroke) => stroke.map((point) => poseToWorld(point, pose)));
  }
}
