import type Matter from "matter-js";
import type { Nature } from "../cat/types";
import { type Pose, poseToWorld, type Stroke, type Vec } from "../core/geometry";
import type { Drawing, DrawingId } from "../ink/types";

export class InkEntity {
  nature: Nature = "ink";
  strength = 1;
  frozen = false;

  constructor(
    readonly drawing: Drawing,
    readonly origin: Vec,
    public body: Matter.Body,
  ) {}

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
