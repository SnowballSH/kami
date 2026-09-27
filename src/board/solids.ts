import type { Rect } from "../core/geometry";
import type { SolidDef } from "./types";

export const marker = (rect: Rect): SolidDef => ({ rect, material: "marker" });

export const glass = (rect: Rect): SolidDef => ({ rect, material: "glass" });
