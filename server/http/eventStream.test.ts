// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type EventStreamEnd, eventStreamResponse } from "./eventStream";

const KIB = 1024;

const manualSource = () => {
  let emit: (event: string) => void = () => {};
  const stop = vi.fn();
  return {
    subscribe: (send: (event: string) => void) => {
      emit = send;
      return stop;
    },
    emit: (event: string) => emit(event),
    stop,
  };
};

const readText = async (reader: ReadableStreamDefaultReader<Uint8Array>, until: string) => {
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes(until)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
};

describe("eventStreamResponse", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the reconnect delay, the events and keep-alives, in order", async () => {
    const source = manualSource();
    const reader = eventStreamResponse(source.subscribe, { keepAliveMs: 1_000 }).body?.getReader();
    if (reader === undefined) throw new Error("no body");
    source.emit("data: 1\n\n");
    vi.advanceTimersByTime(1_000);
    expect(await readText(reader, ": keep-alive")).toBe(
      "retry: 1000\n\ndata: 1\n\n: keep-alive\n\n",
    );
    await reader.cancel();
    expect(source.stop).toHaveBeenCalledOnce();
  });

  it("drops a reader whose queue passes the limit, and counts what waited", async () => {
    const source = manualSource();
    const ends: EventStreamEnd[] = [];
    const response = eventStreamResponse(source.subscribe, {
      maxBacklogBytes: 64 * KIB,
      onEnd: (end) => ends.push(end),
    });
    const event = `data: ${"x".repeat(16 * KIB)}\n\n`;
    for (let i = 0; i < 5; i++) source.emit(event);
    expect(source.stop).toHaveBeenCalledOnce();
    expect(ends).toEqual([expect.objectContaining({ reason: "fell-behind", deliveredBytes: 0 })]);
    expect(ends[0]?.peakBacklogBytes).toBeGreaterThan(64 * KIB);
    expect(ends[0]?.peakBacklogBytes).toBeLessThanOrEqual(64 * KIB + event.length);
    await expect(response.body?.getReader().read()).rejects.toThrow("fell behind");
  });

  it("drops a reader that takes nothing for the stall deadline, even under the byte limit", async () => {
    const source = manualSource();
    const ends: EventStreamEnd[] = [];
    const response = eventStreamResponse(source.subscribe, {
      keepAliveMs: 1_000,
      stallMs: 5_000,
      onEnd: (end) => ends.push(end),
    });
    source.emit("data: waiting\n\n");
    vi.advanceTimersByTime(4_000);
    expect(ends).toEqual([]);
    vi.advanceTimersByTime(1_000);
    expect(ends).toEqual([expect.objectContaining({ reason: "stalled" })]);
    expect(source.stop).toHaveBeenCalledOnce();
    await expect(response.body?.getReader().read()).rejects.toThrow("stalled");
  });

  it("keeps a reader that is slow but still taking events", async () => {
    const source = manualSource();
    const ends: EventStreamEnd[] = [];
    const reader = eventStreamResponse(source.subscribe, {
      keepAliveMs: 1_000,
      stallMs: 2_500,
      onEnd: (end) => ends.push(end),
    }).body?.getReader();
    if (reader === undefined) throw new Error("no body");
    for (let second = 0; second < 10; second++) {
      source.emit(`data: ${second}\n\n`);
      source.emit(`data: ${second}\n\n`);
      await reader.read();
      vi.advanceTimersByTime(1_000);
    }
    expect(ends).toEqual([]);
    await reader.cancel();
    expect(ends).toEqual([expect.objectContaining({ reason: "cancelled" })]);
  });

  it("closes without subscribing when the request is already gone or not authorized", async () => {
    for (const settings of [{ signal: AbortSignal.abort() }, { authorized: () => false }]) {
      const source = manualSource();
      const subscribe = vi.fn(source.subscribe);
      const reader = eventStreamResponse(subscribe, settings).body?.getReader();
      expect((await reader?.read())?.done).toBe(true);
      expect(subscribe).not.toHaveBeenCalled();
    }
  });

  it("stops listening and closes when the request is aborted", async () => {
    const source = manualSource();
    const request = new AbortController();
    const reader = eventStreamResponse(source.subscribe, {
      signal: request.signal,
    }).body?.getReader();
    request.abort();
    expect(source.stop).toHaveBeenCalledOnce();
    expect((await reader?.read())?.done).toBe(true);
  });
});
