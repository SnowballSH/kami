/** A binary heap of items by cost, kept in parallel arrays so pushing allocates nothing; items are never undefined, so a missing one means empty. */
export class MinHeap<T extends NonNullable<unknown>> {
  private readonly items: T[] = [];
  private readonly costs: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: T, cost: number): void {
    const { items, costs } = this;
    let i = items.length;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const above = costs[parent] ?? Number.NEGATIVE_INFINITY;
      if (above <= cost) break;
      this.move(parent, i);
      i = parent;
    }
    items[i] = item;
    costs[i] = cost;
  }

  pop(): { item: T; cost: number } | undefined {
    const { items, costs } = this;
    const item = items[0];
    const cost = costs[0];
    const last = items.pop();
    const lastCost = costs.pop();
    if (item === undefined || cost === undefined) return undefined;
    if (last === undefined || lastCost === undefined || items.length === 0) return { item, cost };
    const count = items.length;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      if (left >= count) break;
      const right = left + 1;
      const leftCost = costs[left] ?? Number.POSITIVE_INFINITY;
      const rightCost = costs[right] ?? Number.POSITIVE_INFINITY;
      const child = right < count && rightCost < leftCost ? right : left;
      if ((costs[child] ?? Number.POSITIVE_INFINITY) >= lastCost) break;
      this.move(child, i);
      i = child;
    }
    items[i] = last;
    costs[i] = lastCost;
    return { item, cost };
  }

  private move(from: number, to: number): void {
    const item = this.items[from];
    const cost = this.costs[from];
    if (item === undefined || cost === undefined) return;
    this.items[to] = item;
    this.costs[to] = cost;
  }
}
