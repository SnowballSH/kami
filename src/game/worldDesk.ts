import { NATURES, type Ruling } from "../cat/types";
import { strokesLength } from "../core/geometry";
import { PIXELS_PER_METRE } from "../core/physics";
import { WORLD } from "../core/world";
import type { Drawing, DrawingId, InkSession } from "../ink/types";
import type { Simulation } from "../sim/types";
import { refuseEdit, shapeStrokes } from "../world";
import type { DrawingFact, EditOutcome, RoomFact, WorldEdit, WorldFacts } from "../world/types";
import type { InkLedger, InkRecord } from "./inkLedger";
import { CONJURED_NAME } from "./lines";
import type { LevelDefinition } from "./types";

export interface Desktop {
  readonly sim: Simulation;
  readonly ink: InkSession;
  readonly ledger: InkLedger;
  readonly mintDrawingId: () => DrawingId;
}

export interface PageContext {
  readonly level: LevelDefinition;
  readonly pageNumber: number;
  readonly pageCount: number;
}

const DEFAULT_STRENGTH = 1;

/** Where the game reads the world out as facts and writes edits back into it. */
export class WorldDesk {
  constructor(private readonly desk: Desktop) {}

  facts(page: PageContext): WorldFacts {
    const { sim, ink } = this.desk;
    const world = sim.snapshot();
    const { alice } = world;
    return {
      page: { width: WORLD.width, height: WORLD.height, pixelsPerMetre: PIXELS_PER_METRE },
      room: this.roomFact(page, world.keyTaken, world.doorOpen, ink.budget),
      physics: sim.physics(),
      alice: {
        position: alice.center,
        width: alice.width,
        height: alice.height,
        size: alice.size,
        facing: alice.facing,
        grounded: alice.grounded,
        climbing: alice.climbing,
        hasKey: alice.hasKey,
      },
      drawings: this.drawingFacts(),
    };
  }

  apply(edits: readonly WorldEdit[], page: PageContext, nowMs: number): readonly EditOutcome[] {
    return edits.map((edit) => {
      const reason = refuseEdit(edit, this.facts(page));
      if (reason !== null) return { edit, applied: false, reason };
      this.write(edit, nowMs);
      return { edit, applied: true };
    });
  }

  private roomFact(
    { level, pageNumber, pageCount }: PageContext,
    keyTaken: boolean,
    doorOpen: boolean,
    ink: RoomFact["ink"],
  ): RoomFact {
    return {
      id: level.id,
      title: level.title,
      pageNumber,
      pageCount,
      allowedNatures: level.allowedNatures === "all" ? [...NATURES] : level.allowedNatures,
      ink,
      spawn: level.spawn,
      exit: level.exit,
      key: level.key ?? null,
      keyTaken,
      door: level.door ?? null,
      doorOpen,
      solids: level.solids.map((solid) => solid.rect),
    };
  }

  private drawingFacts(): readonly DrawingFact[] {
    const { sim, ledger } = this.desk;
    return sim.drawingFacts().flatMap(({ id, bounds, isStatic }) => {
      const record = ledger.record(id);
      if (record === null) return [];
      return [
        {
          id,
          name: record.ruling?.name ?? null,
          nature: record.ruling?.nature ?? "ink",
          strength: record.ruling?.strength ?? DEFAULT_STRENGTH,
          bounds,
          isStatic,
        },
      ];
    });
  }

  private write(edit: WorldEdit, nowMs: number): void {
    const { sim, ink } = this.desk;
    switch (edit.op) {
      case "set_gravity": {
        const { gravity } = sim.physics();
        sim.setPhysics({
          gravity: {
            magnitudeG: edit.magnitudeG ?? gravity.magnitudeG,
            angleDeg: edit.angleDeg ?? gravity.angleDeg,
          },
        });
        return;
      }
      case "set_time_scale":
        sim.setPhysics({ timeScale: edit.factor });
        return;
      case "set_wind":
        sim.setPhysics({ wind: { x: edit.x, y: edit.y } });
        return;
      case "set_air_drag":
        sim.setPhysics({ airDrag: edit.factor });
        return;
      case "set_bounciness":
        sim.setPhysics({ bounciness: edit.restitution });
        return;
      case "set_friction":
        sim.setPhysics({ frictionScale: edit.factor });
        return;
      case "set_walk_speed":
        sim.setPhysics({ walkSpeedFactor: edit.factor });
        return;
      case "resize_alice":
        sim.resizeAlice(edit.size);
        return;
      case "set_nature":
        this.rule(edit.drawingId, edit.nature, edit.strength, edit.name, nowMs);
        return;
      case "remove_drawing":
        this.remove(edit.drawingId);
        return;
      case "spawn_drawing": {
        const strokes = shapeStrokes(edit.shape, edit.at, edit.width, edit.height);
        const drawing: Drawing = {
          id: this.desk.mintDrawingId(),
          strokes,
          cost: strokesLength(strokes),
        };
        sim.addDrawing(drawing);
        this.desk.ledger.add(drawing);
        this.rule(drawing.id, edit.nature, edit.strength, edit.name, nowMs);
        return;
      }
      case "set_ink":
        ink.grant({
          ...(edit.remaining !== undefined ? { remaining: edit.remaining } : {}),
          ...(edit.total !== undefined ? { total: edit.total } : {}),
        });
        return;
      case "reset_physics":
        sim.resetPhysics();
        return;
    }
  }

  private rule(
    id: DrawingId,
    nature: Ruling["nature"],
    strength: number | undefined,
    name: string | undefined,
    nowMs: number,
  ): void {
    const { sim, ledger } = this.desk;
    const before = ledger.record(id);
    if (before === null) return;
    const ruling: Ruling = {
      name: name ?? before.ruling?.name ?? CONJURED_NAME,
      nature,
      strength: strength ?? before.ruling?.strength ?? DEFAULT_STRENGTH,
      tags: before.ruling?.tags ?? [],
      line: before.ruling?.line ?? "",
    };
    sim.applyRuling(id, ruling);
    ledger.awaken(id, ruling, nowMs);
  }

  private remove(id: DrawingId): InkRecord | null {
    const { sim, ink, ledger } = this.desk;
    const record = ledger.erase(id);
    if (record === null) return null;
    sim.removeDrawing(id);
    ink.refund(record.drawing.cost);
    return record;
  }
}
