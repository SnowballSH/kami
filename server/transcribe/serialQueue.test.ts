// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SerialQueue } from "./serialQueue";

interface Gate {
  readonly open: () => void;
  readonly task: () => Promise<string>;
}

const gate = (value: string, started: string[]): Gate => {
  let open = (): void => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    open: () => open(),
    task: async () => {
      started.push(value);
      await opened;
      return value;
    },
  };
};

describe("SerialQueue", () => {
  it("runs one task at a time, in order", async () => {
    const started: string[] = [];
    const queue = new SerialQueue(4);
    const [a, b] = [gate("a", started), gate("b", started)];
    const first = queue.run(a.task);
    const second = queue.run(b.task);
    await Promise.resolve();
    expect(started).toEqual(["a"]);
    a.open();
    expect(await first).toBe("a");
    b.open();
    expect(await second).toBe("b");
    expect(started).toEqual(["a", "b"]);
  });

  it("drops a waiting task whose question was withdrawn, without running it", async () => {
    const started: string[] = [];
    const queue = new SerialQueue(4);
    const [a, b, c] = [gate("a", started), gate("b", started), gate("c", started)];
    const withdrawn = new AbortController();
    const first = queue.run(a.task);
    const dropped = queue.run(b.task, withdrawn.signal);
    const third = queue.run(c.task);
    withdrawn.abort();
    expect(await dropped).toBeNull();
    expect(queue.waiting).toBe(1);
    a.open();
    c.open();
    expect([await first, await third]).toEqual(["a", "c"]);
    expect(started).toEqual(["a", "c"]);
  });

  it("refuses work when full or already withdrawn, and a failed task is null", async () => {
    const started: string[] = [];
    const queue = new SerialQueue(1);
    const [running, next] = [gate("running", started), gate("next", started)];
    const first = queue.run(running.task);
    const waiting = queue.run(next.task);
    expect(await queue.run(gate("overflow", started).task)).toBeNull();
    expect(await queue.run(async () => "late", AbortSignal.abort())).toBeNull();
    running.open();
    next.open();
    expect([await first, await waiting]).toEqual(["running", "next"]);
    expect(started).toEqual(["running", "next"]);
    expect(
      await queue.run(async () => {
        throw new Error("sidecar down");
      }),
    ).toBeNull();
  });
});
