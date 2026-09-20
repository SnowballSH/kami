import { distance, distanceToStroke, type Stroke, type Vec } from "../core/geometry";
import type { DrawingId } from "../ink/types";

export interface ClusterDrawing {
  readonly id: DrawingId;
  readonly strokes: readonly Stroke[];
}

const reaches = (
  strokes: readonly Stroke[],
  cluster: readonly Stroke[],
  heart: Vec,
  reach: number,
): boolean =>
  strokes.some(
    (stroke) =>
      stroke.some((point) => distance(point, heart) <= reach) ||
      stroke.some((point) => cluster.some((other) => distanceToStroke(point, other) <= reach)),
  );

export const clusterAround = (
  seed: ClusterDrawing,
  candidates: readonly ClusterDrawing[],
  heart: Vec,
  reach: number,
): readonly ClusterDrawing[] => {
  const cluster: ClusterDrawing[] = [seed];
  const remaining = candidates.filter(({ id }) => id !== seed.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      if (
        candidate === undefined ||
        !reaches(
          candidate.strokes,
          cluster.flatMap(({ strokes }) => strokes),
          heart,
          reach,
        )
      )
        continue;
      cluster.push(candidate);
      remaining.splice(index, 1);
      index -= 1;
      changed = true;
    }
  }
  return cluster;
};
