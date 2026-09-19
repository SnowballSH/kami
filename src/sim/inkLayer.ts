import Matter from "matter-js";
import type { Ruling } from "../cat/types";
import type { Rect, Stroke } from "../core/geometry";
import { bearingStrokes } from "../ink/bearing";
import type { Drawing, DrawingId } from "../ink/types";
import type { WorldPhysics } from "../rules/types";
import { countAnchorClusters } from "./anchoring";
import { boundsRect } from "./bodyBounds";
import { GHOST_TO_ALICE, SOLID_TO_ALL } from "./contacts";
import { freshMind } from "./creatures";
import { buildInkBody } from "./inkBody";
import { InkEntity } from "./inkEntity";
import { holdsStill, NATURES } from "./natures";
import type { DrawingPose } from "./types";
import { type BodyMaterial, materialUnder, retune } from "./worldPhysics";

type InkState = Pick<InkEntity, "nature" | "strength" | "frozen">;

const PLAIN_INK: InkState = { nature: "ink", strength: 1, frozen: false };

/** Every live drawing on the board, and the matter-js bodies that stand for them. */
export class InkLayer {
  private readonly inks = new Map<DrawingId, InkEntity>();
  private readonly byBodyId = new Map<number, InkEntity>();

  constructor(
    private readonly world: Matter.World,
    private readonly anchorRects: readonly Rect[],
    private physics: WorldPhysics,
  ) {}

  get all(): readonly InkEntity[] {
    return [...this.inks.values()];
  }

  get poses(): readonly DrawingPose[] {
    return this.all.map((ink) => ({ id: ink.id, pose: ink.pose }));
  }

  get dynamicBodies(): readonly Matter.Body[] {
    return this.all.map((ink) => ink.body).filter((body) => !body.isStatic);
  }

  get heldBounds(): readonly Rect[] {
    return this.all.filter((ink) => ink.body.isStatic).map((ink) => boundsRect(ink.body.bounds));
  }

  get spawnMarker(): InkEntity | undefined {
    return this.all.findLast((ink) => ink.nature === "spawn");
  }

  setPhysics(physics: WorldPhysics): void {
    this.physics = physics;
    for (const ink of this.inks.values()) retune(ink.body, this.materialOf(ink));
  }

  find(body: Matter.Body): InkEntity | undefined {
    return this.byBodyId.get(body.id);
  }

  add(drawing: Drawing): void {
    if (this.inks.has(drawing.id)) return;
    const body = this.build(drawing.strokes, drawing.strokes, PLAIN_INK);
    if (body === null) return;
    const { x, y } = body.position;
    const ink = new InkEntity(drawing, { x, y }, body);
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
    const ink = this.inks.get(id);
    if (ink === undefined) return;
    ink.nature = ruling.nature;
    ink.strength = ruling.strength;
    ink.frozen = false;
    ink.mind = freshMind(ink.id);
    this.rebuild(ink);
  }

  freeze(ink: InkEntity): void {
    if (ink.frozen || ink.body.isStatic) return;
    ink.frozen = true;
    this.rebuild(ink);
  }

  private rebuild(ink: InkEntity): void {
    const previous = ink.body;
    const { pinned, upright } = NATURES[ink.nature];
    const worldStrokes = pinned ? ink.drawing.strokes : ink.worldStrokes;
    const body = this.build(ink.drawing.strokes, worldStrokes, ink);
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
    const anchorClusters = countAnchorClusters(worldStrokes, this.anchorRects);
    return buildInkBody(bearingStrokes(drawnStrokes), {
      isStatic: state.frozen || holdsStill(strategy, anchorClusters),
      material: this.materialOf(state),
      collisionFilter: strategy.solidToAlice ? SOLID_TO_ALL : GHOST_TO_ALICE,
      upright: strategy.upright,
    });
  }

  private materialOf(state: InkState): BodyMaterial {
    return materialUnder(this.physics, NATURES[state.nature].material(state.strength));
  }

  private attach(ink: InkEntity): void {
    this.byBodyId.set(ink.body.id, ink);
    Matter.Composite.add(this.world, ink.body);
  }

  private detach(ink: InkEntity): void {
    this.byBodyId.delete(ink.body.id);
    Matter.Composite.remove(this.world, ink.body);
  }
}
