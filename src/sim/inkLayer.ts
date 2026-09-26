import Matter from "matter-js";
import { heedOf } from "../cat/temper";
import { type Ruling, STRENGTH_RANGE } from "../cat/types";
import { type Rect, type Stroke, scaleAbout, type Vec } from "../core/geometry";
import { bearingStrokes } from "../ink/bearing";
import type { Drawing, DrawingId } from "../ink/types";
import { motionOf } from "../rules/motion";
import { STILL, type WorldPhysics } from "../rules/types";
import { countAnchorClusters } from "./anchoring";
import { boundsRect } from "./bodyBounds";
import { GHOST_TO_ALICE, SOLID_TO_ALL } from "./contacts";
import { freshMind } from "./creatures";
import { buildInkBody } from "./inkBody";
import { InkEntity } from "./inkEntity";
import { holdsStill, NATURES } from "./natures";
import type { DrawingPose, InkProvenance } from "./types";
import { type BodyMaterial, materialMoved, materialUnder, retune } from "./worldPhysics";

type InkState = Pick<InkEntity, "nature" | "strength" | "frozen" | "motion">;

const sized = (strokes: readonly Stroke[], centre: Vec, size: number): readonly Stroke[] =>
  size === 1
    ? strokes
    : strokes.map((stroke) => stroke.map((point) => scaleAbout(point, centre, size)));

const PLAIN_INK: InkState = { nature: "ink", strength: 1, frozen: false, motion: STILL };

/** Where ink may anchor on the board, as it stands now. */
export interface AnchorSource {
  readonly anchorRects: readonly Rect[];
}

/** Every live drawing on the board, and the matter-js bodies that stand for them. */
export class InkLayer {
  private readonly inks = new Map<DrawingId, InkEntity>();
  private readonly byBodyId = new Map<number, InkEntity>();
  private cachedAll: readonly InkEntity[] | null = null;
  private cachedDynamicBodies: readonly Matter.Body[] | null = null;
  private cachedHeldBounds: readonly Rect[] | null = null;

  constructor(
    private readonly world: Matter.World,
    private readonly anchors: AnchorSource,
    private physics: WorldPhysics,
  ) {}

  get all(): readonly InkEntity[] {
    if (this.cachedAll === null) this.cachedAll = [...this.inks.values()];
    return this.cachedAll;
  }

  get poses(): readonly DrawingPose[] {
    return this.all.map((ink) => ({ id: ink.id, pose: ink.pose, lit: ink.lit }));
  }

  get dynamicBodies(): readonly Matter.Body[] {
    if (this.cachedDynamicBodies === null) {
      this.cachedDynamicBodies = this.all.map((ink) => ink.body).filter((body) => !body.isStatic);
    }
    return this.cachedDynamicBodies;
  }

  get heldBounds(): readonly Rect[] {
    if (this.cachedHeldBounds === null) {
      this.cachedHeldBounds = this.all
        .filter((ink) => ink.body.isStatic)
        .map((ink) => boundsRect(ink.body.bounds));
    }
    return this.cachedHeldBounds;
  }

  get spawnMarker(): InkEntity | undefined {
    return this.all.findLast((ink) => ink.nature === "spawn");
  }

  setPhysics(physics: WorldPhysics): void {
    this.physics = physics;
    for (const ink of this.inks.values()) {
      const wasSize = ink.motion.size;
      this.resolveMotion(ink);
      if (ink.motion.size !== wasSize) this.resize(ink);
      else retune(ink.body, this.materialOf(ink));
    }
  }

  find(body: Matter.Body): InkEntity | undefined {
    return this.byBodyId.get(body.id);
  }

  add(drawing: Drawing, provenance: InkProvenance = "drawn"): void {
    if (this.inks.has(drawing.id)) return;
    const body = this.build(drawing.strokes, drawing.strokes, PLAIN_INK);
    if (body === null) return;
    const { x, y } = body.position;
    const ink = new InkEntity(drawing, { x, y }, body, provenance);
    this.inks.set(drawing.id, ink);
    this.attach(ink);
  }

  remove(id: DrawingId): void {
    const ink = this.inks.get(id);
    if (ink === undefined) return;
    this.detach(ink);
    this.inks.delete(id);
  }

  applyRuling(id: DrawingId, ruling: Ruling): void {
    if (
      !Number.isFinite(ruling.strength) ||
      ruling.strength < STRENGTH_RANGE.min ||
      ruling.strength > STRENGTH_RANGE.max
    ) {
      throw new RangeError("Invalid ruling strength");
    }
    const ink = this.inks.get(id);
    if (ink === undefined) return;
    ink.nature = ruling.nature;
    ink.name = ruling.name;
    ink.strength = ruling.strength;
    ink.own = { ...ruling.motion, ...heedOf(ruling.temper) };
    ink.frozen = false;
    ink.mind = freshMind(ink.id);
    this.resolveMotion(ink);
    this.rebuild(ink);
  }

  freeze(ink: InkEntity): void {
    if (ink.frozen || ink.body.isStatic) return;
    ink.frozen = true;
    this.rebuild(ink);
  }

  /** Grows or shrinks it about its centre, keeping its feet where they were so it does not sink into the ground. */
  private resize(ink: InkEntity): void {
    const feet = ink.body.bounds.max.y;
    this.rebuild(ink);
    if (ink.body.isStatic) return;
    Matter.Body.translate(ink.body, { x: 0, y: feet - ink.body.bounds.max.y });
  }

  private rebuild(ink: InkEntity): void {
    const previous = ink.body;
    const { pinned, upright } = NATURES[ink.nature];
    const drawnStrokes = sized(ink.drawing.strokes, ink.origin, ink.motion.size);
    const worldStrokes = pinned ? drawnStrokes : ink.worldStrokes;
    const body = this.build(drawnStrokes, worldStrokes, ink);
    if (body === null) return;
    if (!pinned) {
      Matter.Body.setPosition(body, previous.position);
      Matter.Body.setAngle(body, upright ? 0 : previous.angle);
    }
    if (!body.isStatic) {
      Matter.Body.setVelocity(body, Matter.Body.getVelocity(previous));
      Matter.Body.setAngularVelocity(body, Matter.Body.getAngularVelocity(previous));
    }
    this.detach(ink);
    ink.body = body;
    this.attach(ink);
  }

  private build(
    drawnStrokes: readonly Stroke[],
    worldStrokes: readonly Stroke[],
    state: InkState,
  ): Matter.Body | null {
    const strategy = NATURES[state.nature];
    const anchorClusters = countAnchorClusters(worldStrokes, this.anchors.anchorRects);
    return buildInkBody(bearingStrokes(drawnStrokes), {
      isStatic: state.frozen || holdsStill(strategy, anchorClusters),
      material: this.materialOf(state),
      collisionFilter: strategy.solidToAlice ? SOLID_TO_ALL : GHOST_TO_ALICE,
      upright: strategy.upright,
    });
  }

  private resolveMotion(ink: InkEntity): void {
    const wasSpinning = ink.motion.spin !== 0;
    ink.motion = motionOf(ink.own, this.physics.bodies, ink.name);
    if (wasSpinning && ink.motion.spin === 0 && !ink.body.isStatic) {
      Matter.Body.setAngularVelocity(ink.body, 0);
    }
  }

  private materialOf(state: InkState): BodyMaterial {
    return materialMoved(
      materialUnder(this.physics, NATURES[state.nature].material(state.strength)),
      state.motion,
    );
  }

  private invalidate(): void {
    this.cachedAll = null;
    this.cachedDynamicBodies = null;
    this.cachedHeldBounds = null;
  }

  private attach(ink: InkEntity): void {
    this.byBodyId.set(ink.body.id, ink);
    Matter.Composite.add(this.world, ink.body);
    this.invalidate();
  }

  private detach(ink: InkEntity): void {
    this.byBodyId.delete(ink.body.id);
    Matter.Composite.remove(this.world, ink.body);
    this.invalidate();
  }
}
