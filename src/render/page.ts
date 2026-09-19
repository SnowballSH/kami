import rough from "roughjs";
import type { Drawable } from "roughjs/bin/core";
import { WORLD } from "../core/world";
import type { LevelDefinition } from "../game/types";
import { context2d, createCanvas } from "./canvas2d";
import { paintExitHole } from "./exitHole";
import { composeLevelArt } from "./levelArt";
import { paintPaper } from "./paper";

const MAX_RASTER_SCALE = 3;
const UNRASTERIZED = 0;

export class Page {
  readonly image: HTMLCanvasElement = createCanvas({ width: 1, height: 1 });
  private readonly art: readonly Drawable[];
  private rasterScale = UNRASTERIZED;

  constructor(private readonly level: LevelDefinition) {
    this.art = composeLevelArt(level);
  }

  rasterize(pixelsPerWorldPx: number): void {
    const scale = Math.min(pixelsPerWorldPx, MAX_RASTER_SCALE);
    if (scale === this.rasterScale) return;
    this.rasterScale = scale;
    this.image.width = Math.max(1, Math.ceil(WORLD.width * scale));
    this.image.height = Math.max(1, Math.ceil(WORLD.height * scale));
    const ctx = context2d(this.image);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    paintPaper(ctx);
    const press = rough.canvas(this.image);
    for (const drawable of this.art) press.draw(drawable);
    paintExitHole(ctx, this.level.exit);
  }
}
