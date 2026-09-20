import type { Rect } from "../core/geometry";
import type { BoardDefinition } from "./types";

export const groundSolids = (board: Pick<BoardDefinition, "solids" | "spawn">): readonly Rect[] =>
  board.solids.map(({ rect }) => rect).filter((rect) => rect.y + rect.height >= board.spawn.y);
