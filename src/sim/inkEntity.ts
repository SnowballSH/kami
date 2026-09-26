import type Matter from "matter-js";
import { temperOfHeed } from "../cat/temper";
import type { Nature, Temper } from "../cat/types";
import { type Pose, poseToWorld, type Stroke, type Vec } from "../core/geometry";
import type { Drawing, DrawingId } from "../ink/types";
import { type Motion, type MotionEdit, STILL } from "../rules/types";
import { freshMind, type Mind } from "./creatures";
import type { InkProvenance } from "./types";

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
    readonly provenance: InkProvenance = "drawn",
  ) {
    this.mind = freshMind(drawing.id);
  }

  get id(): DrawingId {
    return this.drawing.id;
  }

  /** How it takes to Alice, if it is a creature with feelings about her: its `heed` dial, read. */
  get temper(): Temper | null {
    return temperOfHeed(this.motion.heed);
  }

  /** Whether it lights its patch at night: a lantern by nature, or anything given the `glow` power. */
  get lit(): boolean {
    return this.nature === "lantern" || this.motion.glow > 0;
  }

  get pose(): Pose {
    const { position, angle } = this.body;
    return {
      origin: this.origin,
      position: { x: position.x, y: position.y },
      angle,
      scale: this.motion.size,
    };
  }

  get worldStrokes(): readonly Stroke[] {
    const pose = this.pose;
    return this.drawing.strokes.map((stroke) => stroke.map((point) => poseToWorld(point, pose)));
  }
}
