import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Stroke } from "../../src/core/geometry";
import { parseNpy } from "./npy";
import type { Sketch, SketchLibrary } from "./types";

/** Only the best few of a category are summoned, so what appears is always a recognisable one. */
const PICK_AMONG_BEST = 24;

const metaSchema = z.object({
  count: z.number().int().nonnegative(),
  categories: z.array(z.string().min(1)),
});

interface Window {
  readonly start: number;
  readonly end: number;
}

const windowsByLabel = (labels: ArrayLike<number>, classes: number): readonly Window[] => {
  const windows: Window[] = [];
  let start = 0;
  for (let label = 0; label < classes; label++) {
    let end = start;
    while (end < labels.length && labels[end] === label) end++;
    windows.push({ start, end });
    start = end;
  }
  return windows;
};

/**
 * The exemplar set the Eye was built with (ml/CONTRACT.md): every category's cleanest Quick, Draw!
 * drawings, sorted by label with the best first. Loaded once, about 80 MB for 345 × 200.
 */
export class ExemplarLibrary implements SketchLibrary {
  private constructor(
    readonly categories: readonly string[],
    private readonly windows: readonly Window[],
    private readonly points: Uint8Array,
    private readonly strokeOffsets: Uint32Array,
    private readonly drawingOffsets: Uint32Array,
    private readonly random: () => number,
  ) {}

  static async load(
    directory: string,
    random: () => number = Math.random,
  ): Promise<ExemplarLibrary> {
    const bytes = (name: string) => readFile(join(directory, name));
    const [metaText, labels, points, strokeOffsets, drawingOffsets] = await Promise.all([
      readFile(join(directory, "meta.json"), "utf8"),
      bytes("labels.npy"),
      bytes("points.npy"),
      bytes("stroke_offsets.npy"),
      bytes("drawing_offsets.npy"),
    ]);
    const meta = metaSchema.parse(JSON.parse(metaText));
    const labelArray = parseNpy(new Uint8Array(labels)).data;
    const pointArray = parseNpy(new Uint8Array(points)).data;
    const strokeArray = parseNpy(new Uint8Array(strokeOffsets)).data;
    const drawingArray = parseNpy(new Uint8Array(drawingOffsets)).data;
    if (labelArray.length !== meta.count || drawingArray.length !== meta.count + 1)
      throw new Error(`exemplars: ${directory} does not hold ${meta.count} drawings`);
    if (!(pointArray instanceof Uint8Array)) throw new Error("exemplars: points must be uint8");
    if (!(strokeArray instanceof Uint32Array) || !(drawingArray instanceof Uint32Array))
      throw new Error("exemplars: offsets must be uint32");
    return new ExemplarLibrary(
      meta.categories,
      windowsByLabel(labelArray, meta.categories.length),
      pointArray,
      strokeArray,
      drawingArray,
      random,
    );
  }

  get size(): number {
    return this.drawingOffsets.length - 1;
  }

  pick(category: string): Promise<Sketch | null> {
    const label = this.categories.indexOf(category);
    const window = this.windows[label];
    if (window === undefined || window.end === window.start) return Promise.resolve(null);
    const among = Math.min(PICK_AMONG_BEST, window.end - window.start);
    const index = window.start + Math.floor(this.random() * among);
    return Promise.resolve({ category, strokes: this.drawing(index) });
  }

  describe(): string {
    return `summoning: ${this.size} exemplars of ${this.categories.length} categories`;
  }

  private drawing(index: number): readonly Stroke[] {
    const strokes: Stroke[] = [];
    const first = this.drawingOffsets[index] ?? 0;
    const last = this.drawingOffsets[index + 1] ?? first;
    for (let stroke = first; stroke < last; stroke++) {
      const from = this.strokeOffsets[stroke] ?? 0;
      const to = this.strokeOffsets[stroke + 1] ?? from;
      const points = [];
      for (let point = from; point < to; point++) {
        points.push({ x: this.points[point * 2] ?? 0, y: this.points[point * 2 + 1] ?? 0 });
      }
      strokes.push(points);
    }
    return strokes;
  }
}
