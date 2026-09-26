import type { CellRange } from "./chart";

/** A search node's identity: its slot on the grid, or its coordinates when it lies off it. */
export type NodeKey = number | string;

const UNKNOWN = 0;
const NO = 1;
const YES = 2;

/**
 * Every feet position a body can take inside a chart: columns [c0, c1) and rows [r0, r1], since
 * feet may rest on the chart's bottom edge. Slots are relative to the chart, so absolute
 * coordinates of any size index safely.
 */
export class NodeGrid {
  readonly size: number;
  private readonly stride: number;

  constructor(private readonly range: CellRange) {
    this.stride = range.c1 - range.c0;
    this.size = this.stride * (range.r1 - range.r0 + 1);
  }

  /** The node's slot, or -1 off the grid. */
  indexOf(c0: number, r0: number): number {
    const { range } = this;
    if (c0 < range.c0 || c0 >= range.c1 || r0 < range.r0 || r0 > range.r1) return -1;
    return (r0 - range.r0) * this.stride + (c0 - range.c0);
  }

  keyOf(c0: number, r0: number): NodeKey {
    const index = this.indexOf(c0, r0);
    return index < 0 ? `${r0},${c0}` : index;
  }
}

/** A yes/no question about a node, worked out at most once per node on the grid and afresh off it. */
export class NodeMemo {
  private answers: Uint8Array | null = null;

  constructor(
    private readonly grid: NodeGrid,
    private readonly work: (c0: number, r0: number) => boolean,
  ) {}

  ask(c0: number, r0: number): boolean {
    const index = this.grid.indexOf(c0, r0);
    if (index < 0) return this.work(c0, r0);
    this.answers ??= new Uint8Array(this.grid.size);
    const known = this.answers[index];
    if (known !== UNKNOWN) return known === YES;
    const answer = this.work(c0, r0);
    this.answers[index] = answer ? YES : NO;
    return answer;
  }
}
