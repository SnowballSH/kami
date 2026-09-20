// @vitest-environment node
import { describe, expect, it } from "vitest";
import { controllerEventStream, KEEP_ALIVE_MS } from "./eventStream";
import { readEvents } from "./testing/eventReader";
import type { ControllerHub, ControllerListener, ControllerState } from "./types";

const AT_REST: ControllerState = { x: 0, y: 0, held: [], buttons: [] };
const BUN_IDLE_TIMEOUT_MS = 10_000;

class OneControllerHub implements ControllerHub {
  readonly listeners = new Set<ControllerListener>();

  say(state: ControllerState): void {
    for (const listener of this.listeners) listener(state);
  }

  subscribe(_id: string, listener: ControllerListener): () => void {
    this.listeners.add(listener);
    listener(AT_REST);
    return () => this.listeners.delete(listener);
  }

  report(): void {}
  list(): readonly never[] {
    return [];
  }
  close(): void {}
}

describe("the controller event stream", () => {
  it("leaves origin policy to the API boundary", async () => {
    const response = controllerEventStream(new OneControllerHub(), "arcade");
    const { headers } = response;
    expect(headers.get("content-type")).toBe("text/event-stream");
    expect(headers.get("cache-control")).toContain("no-cache");
    expect(headers.has("access-control-allow-origin")).toBe(false);
    await response.body?.cancel();
  });

  it("asks for a quick reconnect, then sends the state now and every change", async () => {
    const hub = new OneControllerHub();
    const events = readEvents(controllerEventStream(hub, "arcade"));
    expect(await events.nextBlock()).toBe("retry: 1000");
    expect(await events.nextBlock()).toBe('data: {"x":0,"y":0,"held":[],"buttons":[]}');
    hub.say({ x: -0.7, y: 0.85, held: ["left", "up"], buttons: ["a"] });
    expect(await events.nextBlock()).toBe(
      'data: {"x":-0.7,"y":0.85,"held":["left","up"],"buttons":["a"]}',
    );
    await events.cancel();
  });

  it("keeps the connection warm with comments, well inside Bun's idle timeout", async () => {
    expect(KEEP_ALIVE_MS).toBeLessThanOrEqual(BUN_IDLE_TIMEOUT_MS / 2);
    const events = readEvents(
      controllerEventStream(new OneControllerHub(), "arcade", { keepAliveMs: 5 }),
    );
    await events.nextEvent();
    expect(await events.nextBlock()).toBe(": keep-alive");
    expect(await events.nextBlock()).toBe(": keep-alive");
    await events.cancel();
  });

  it("unsubscribes when the reader cancels", async () => {
    const hub = new OneControllerHub();
    const events = readEvents(controllerEventStream(hub, "arcade"));
    await events.nextEvent();
    expect(hub.listeners.size).toBe(1);
    await events.cancel();
    expect(hub.listeners.size).toBe(0);
  });

  it("unsubscribes when the request is aborted", async () => {
    const hub = new OneControllerHub();
    const request = new AbortController();
    const events = readEvents(controllerEventStream(hub, "arcade", { signal: request.signal }));
    await events.nextEvent();
    request.abort();
    expect(hub.listeners.size).toBe(0);
  });

  it("does not leave subscriptions when authorization expires during stream setup", async () => {
    const hub = new OneControllerHub();
    let checks = 0;
    const response = controllerEventStream(hub, "arcade", {
      authorized: () => ++checks < 3,
    });
    const reader = response.body?.getReader();
    await reader?.read();
    expect((await reader?.read())?.done).toBe(true);
    expect(hub.listeners.size).toBe(0);
  });
});
