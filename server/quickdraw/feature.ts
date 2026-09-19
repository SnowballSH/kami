import type { Stroke, Vec } from "../../src/core/geometry";

export const FEATURE_GRID_SIZE = 24;
export const FEATURE_LENGTH = FEATURE_GRID_SIZE * FEATURE_GRID_SIZE;

const GRID_MARGIN = 1.5;
const RASTER_STEP = 0.5;
const BLUR_KERNEL = [0.25, 0.5, 0.25] as const;

type Grid = Float32Array;

const boundsOfStrokes = (strokes: readonly Stroke[]) => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const stroke of strokes) {
    for (const { x, y } of stroke) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY };
};

const normaliseToGrid = (strokes: readonly Stroke[]): readonly Stroke[] => {
  const { minX, minY, width, height } = boundsOfStrokes(strokes);
  const extent = Math.max(width, height);
  const drawable = FEATURE_GRID_SIZE - 1 - GRID_MARGIN * 2;
  const scale = extent > 0 ? drawable / extent : 0;
  const offsetX = (FEATURE_GRID_SIZE - 1 - width * scale) / 2;
  const offsetY = (FEATURE_GRID_SIZE - 1 - height * scale) / 2;
  return strokes.map((stroke) =>
    stroke.map(({ x, y }) => ({
      x: offsetX + (x - minX) * scale,
      y: offsetY + (y - minY) * scale,
    })),
  );
};

const splat = (grid: Grid, { x, y }: Vec): void => {
  const column = Math.floor(x);
  const row = Math.floor(y);
  const fx = x - column;
  const fy = y - row;
  for (const [dx, dy, weight] of [
    [0, 0, (1 - fx) * (1 - fy)],
    [1, 0, fx * (1 - fy)],
    [0, 1, (1 - fx) * fy],
    [1, 1, fx * fy],
  ] as const) {
    const cellColumn = column + dx;
    const cellRow = row + dy;
    if (cellColumn < 0 || cellRow < 0) continue;
    if (cellColumn >= FEATURE_GRID_SIZE || cellRow >= FEATURE_GRID_SIZE) continue;
    const index = cellRow * FEATURE_GRID_SIZE + cellColumn;
    grid[index] = Math.max(grid[index] ?? 0, weight);
  }
};

const drawSegment = (grid: Grid, from: Vec, to: Vec): void => {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / RASTER_STEP));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    splat(grid, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }
};

const rasterise = (strokes: readonly Stroke[]): Grid => {
  const grid = new Float32Array(FEATURE_LENGTH);
  for (const stroke of strokes) {
    for (const [index, point] of stroke.entries()) {
      drawSegment(grid, stroke[index - 1] ?? point, point);
    }
  }
  return grid;
};

const blurAlong = (grid: Grid, stride: number, otherStride: number): Grid => {
  const blurred = new Float32Array(FEATURE_LENGTH);
  for (let line = 0; line < FEATURE_GRID_SIZE; line += 1) {
    for (let cell = 0; cell < FEATURE_GRID_SIZE; cell += 1) {
      let sum = 0;
      for (const [tap, weight] of BLUR_KERNEL.entries()) {
        const neighbour = cell + tap - 1;
        if (neighbour < 0 || neighbour >= FEATURE_GRID_SIZE) continue;
        sum += weight * (grid[line * otherStride + neighbour * stride] ?? 0);
      }
      blurred[line * otherStride + cell * stride] = sum;
    }
  }
  return blurred;
};

const blur = (grid: Grid): Grid =>
  blurAlong(blurAlong(grid, 1, FEATURE_GRID_SIZE), FEATURE_GRID_SIZE, 1);

const l2Normalise = (grid: Grid): Grid => {
  const norm = Math.hypot(...grid);
  return norm > 0 ? grid.map((value) => value / norm) : grid;
};

/**
 * A sketch as a unit vector: strokes fitted to a small square grid (aspect kept, centred),
 * rasterised, softened by one blur pass and L2-normalised, so a dot product is cosine similarity.
 */
export const computeFeature = (strokes: readonly Stroke[]): Float32Array => {
  const inked = strokes.filter((stroke) => stroke.length > 0);
  if (inked.length === 0) return new Float32Array(FEATURE_LENGTH);
  return l2Normalise(blur(rasterise(normaliseToGrid(inked))));
};
