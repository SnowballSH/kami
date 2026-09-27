import type Matter from "matter-js";
import { temperOfHeed } from "../cat/temper";
import type { Nature, Temper } from "../cat/types";
import { type Pose, poseToWorld, type Stroke, type Vec } from "../core/geometry";
import type { Drawing, DrawingId, InkProvenance } from "../ink/types";
import { type Motion, type MotionEdit, STILL } from "../rules/types";
import { freshMind, type Mind } from "./creatures";

/** What a nature does of itself, as motion a law can override: "the lamp stops glowing" puts it out. */
const MOTION_BY_NATURE: Readonly<Partial<Record<Nature, MotionEdit>>> = {
  lantern: { glow: 1 },
};

/** A drawing's own motion: its nature's, then what its name asked for on top. */
export const ownMotion = (nature: Nature, asked: MotionEdit): MotionEdit => ({
  ...MOTION_BY_NATURE[nature],
  ...asked,
});

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

  /** Whether it lights its patch at night: a lantern unless a law puts it out, or anything given the `glow` power. */
  get lit(): boolean {
    return this.motion.glow > 0;
  }

  /** The middle of its bounding box in the world. */
  get centre(): Vec {
    const { min, max } = this.body.bounds;
    return { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 };
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
