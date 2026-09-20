import { describe, expect, it } from "vitest";
import type { Stroke } from "../core/geometry";
import type { DrawingId } from "../ink/types";
import { type ClusterDrawing, clusterAround } from "./bossCluster";

const drawing = (id: string, x: number, y: number): ClusterDrawing => ({
  id: id as DrawingId,
  strokes: [[{ x, y } satisfies Stroke[number]]],
});

describe("clusterAround", () => {
  it("follows nearby drawings through a chain", () => {
    const cluster = clusterAround(
      drawing("seed", 0, 0),
      [drawing("near", 30, 0), drawing("chain", 60, 0), drawing("far", 300, 0)],
      { x: 0, y: 0 },
      36,
    );
    expect(cluster.map(({ id }) => id)).toEqual(["seed", "near", "chain"]);
    expect(cluster.some(({ id }) => id === ("far" as DrawingId))).toBe(false);
  });
});
