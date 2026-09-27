import { describe, expect, it } from "vitest";
import { MinHeap } from "./minHeap";

describe("MinHeap", () => {
  it("pops the cheapest first, whatever order they were pushed in", () => {
    const heap = new MinHeap<string>();
    for (const [item, cost] of [
      ["c", 3],
      ["a", 1],
      ["e", 5],
      ["b", 2],
      ["d", 4],
    ] as const)
      heap.push(item, cost);
    const popped: string[] = [];
    for (let top = heap.pop(); top !== undefined; top = heap.pop()) popped.push(top.item);
    expect(popped).toEqual(["a", "b", "c", "d", "e"]);
    expect(heap.size).toBe(0);
  });
});
