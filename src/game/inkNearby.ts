import { boundsOf, poseToWorld, type Rect, rectGap, type Stroke, type Vec } from "../core/geometry";
import type { Drawing, DrawingId } from "../ink/types";
import type { DrawingPose } from "../sim/types";
import { type ClusterDrawing, clusterAround } from "./bossCluster";
import type { InkLedger, InkRecord } from "./inkLedger";

export interface NearInk {
  readonly record: InkRecord;
  readonly gap: number;
}

export interface BodyCluster {
  readonly strokes: readonly Stroke[];
  readonly members: readonly ClusterDrawing[];
}

const posedBounds = (drawing: Drawing, { pose }: DrawingPose): Rect =>
  boundsOf(drawing.strokes.flatMap((stroke) => stroke.map((point) => poseToWorld(point, pose))));

const pointRect = ({ x, y }: Vec): Rect => ({ x: x - 0.5, y: y - 0.5, width: 1, height: 1 });

/** The ink on the page nearest `target`, as it lies now, among the records `accepts` lets through. */
export const nearestInk = (
  target: Rect | Vec,
  poses: readonly DrawingPose[],
  ledger: InkLedger,
  accepts: (record: InkRecord) => boolean = () => true,
): NearInk | null => {
  const rect = "width" in target ? target : pointRect(target);
  let nearest: NearInk | null = null;
  for (const pose of poses) {
    const record = ledger.get(pose.id);
    if (record === null || !accepts(record)) continue;
    const gap = rectGap(rect, posedBounds(record.drawing, pose));
    if (nearest === null || gap < nearest.gap) nearest = { record, gap };
  }
  return nearest;
};

/** The unnamed ink that joins `seedId` into a body around the heart. */
export const bodyCluster = (
  seedId: DrawingId,
  heart: Vec,
  poses: readonly DrawingPose[],
  ledger: InkLedger,
  reach: number,
): BodyCluster | null => {
  const candidates = poses.flatMap(({ id }) => {
    const record = ledger.get(id);
    if (record === null || (record.ruling !== null && id !== seedId)) return [];
    return [{ id, strokes: record.drawing.strokes }];
  });
  const seed = candidates.find(({ id }) => id === seedId);
  if (seed === undefined) return null;
  const members = clusterAround(seed, candidates, heart, reach);
  return { members, strokes: members.flatMap(({ strokes }) => strokes) };
};
