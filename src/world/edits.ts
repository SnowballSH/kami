import { NATURES, type Nature } from "../cat/types";
import { ALICE_SCALE, type AliceSize } from "../sim/types";
import { SPAWN_SHAPES, type SpawnShape, type WorldEdit, type WorldFacts } from "./types";

const finite = (value: number | undefined): boolean =>
  value === undefined || Number.isFinite(value);

const isNature = (value: string): value is Nature => (NATURES as readonly string[]).includes(value);
const isSize = (value: string): value is AliceSize => value in ALICE_SCALE;
const isShape = (value: string): value is SpawnShape =>
  (SPAWN_SHAPES as readonly string[]).includes(value);

const knownDrawing = (facts: WorldFacts, id: string): boolean =>
  facts.drawings.some((drawing) => drawing.id === id);

/**
 * Why an edit cannot be applied, or null when it can. Only shape and sanity are checked —
 * the sandbox is unbounded, so any finite number is a legal value.
 */
export const refuseEdit = (edit: WorldEdit, facts: WorldFacts): string | null => {
  switch (edit.op) {
    case "set_gravity":
      if (edit.magnitudeG === undefined && edit.angleDeg === undefined) return "nothing to change";
      return finite(edit.magnitudeG) && finite(edit.angleDeg) ? null : "gravity must be a number";
    case "set_time_scale":
      if (!finite(edit.factor)) return "time must be a number";
      return edit.factor < 0 ? "time does not run backwards here" : null;
    case "set_wind":
      return finite(edit.x) && finite(edit.y) ? null : "wind must be a number";
    case "set_air_drag":
      if (!finite(edit.factor)) return "drag must be a number";
      return edit.factor < 0 ? "air cannot push things faster" : null;
    case "set_bounciness":
      return finite(edit.restitution) && edit.restitution >= 0 ? null : "bounce must be 0 or more";
    case "set_friction":
      return finite(edit.factor) && edit.factor >= 0 ? null : "friction must be 0 or more";
    case "set_walk_speed":
      return finite(edit.factor) && edit.factor >= 0 ? null : "speed must be 0 or more";
    case "resize_alice":
      return isSize(edit.size) ? null : "she only comes in small, normal, and big";
    case "set_nature":
      if (!knownDrawing(facts, edit.drawingId)) return "no such drawing";
      if (!isNature(edit.nature)) return "no such nature";
      return finite(edit.strength) ? null : "strength must be a number";
    case "remove_drawing":
      return knownDrawing(facts, edit.drawingId) ? null : "no such drawing";
    case "spawn_drawing":
      if (!isShape(edit.shape)) return "no such shape";
      if (!isNature(edit.nature)) return "no such nature";
      if (!finite(edit.at.x) || !finite(edit.at.y)) return "place must be a point";
      if (!finite(edit.width) || !finite(edit.height)) return "size must be a number";
      if (edit.width <= 0 || edit.height <= 0) return "size must be more than nothing";
      return finite(edit.strength) ? null : "strength must be a number";
    case "set_ink":
      if (edit.remaining === undefined && edit.total === undefined) return "nothing to change";
      if (!finite(edit.remaining) || !finite(edit.total)) return "ink must be a number";
      return (edit.remaining ?? 0) < 0 || (edit.total ?? 0) < 0 ? "ink cannot be negative" : null;
    case "reset_physics":
      return null;
  }
};
