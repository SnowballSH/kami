// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FORGET_AFTER_MS, InMemoryControllerHub, STALE_AFTER_MS } from "./hub";
import { ManualClock } from "./testing/manualClock";
import type { Button, ControllerReading, ControllerState } from "./types";

const AT_REST: ControllerState = { x: 0, y: 0, held: [], buttons: [] };

const stick = (x: number, y: number, ...buttons: Button[]): ControllerReading => ({
  x,
  y,
  buttons,
});

let clock: ManualClock;
let hub: InMemoryControllerHub;
let heard: ControllerState[];

const heldAfter = (x: number, y: number, ...buttons: Button[]): readonly string[] => {
  hub.report("arcade", stick(x, y, ...buttons), "udp");
  return heard.at(-1)?.held ?? [];
};

beforeEach(() => {
  clock = new ManualClock();
  hub = new InMemoryControllerHub(clock);
  heard = [];
  hub.subscribe("arcade", (state) => heard.push(state));
});

describe("what a subscriber hears", () => {
  it("is the state right now, then every change and nothing else", () => {
    expect(heard).toEqual([AT_REST]);
    hub.report("arcade", stick(-70, 85, "a"), "udp");
    hub.report("arcade", stick(-70, 85, "a"), "udp");
    hub.report("arcade", stick(-73, 85, "a"), "udp");
    expect(heard.slice(1)).toEqual([
      { x: -0.7, y: 0.85, held: ["left", "up"], buttons: ["a"] },
      { x: -0.73, y: 0.85, held: ["left", "up"], buttons: ["a"] },
    ]);
  });

  it("is the live state for someone who joins late", () => {
    hub.report("arcade", stick(100, 0), "serial");
    const late: ControllerState[] = [];
    hub.subscribe("arcade", (state) => late.push(state));
    expect(late).toEqual([{ x: 1, y: 0, held: ["right"], buttons: [] }]);
  });

  it("is only its own controller, and nothing once unsubscribed", () => {
    const other: ControllerState[] = [];
    const unsubscribe = hub.subscribe("other", (state) => other.push(state));
    hub.report("other", stick(0, -100), "http");
    unsubscribe();
    hub.report("other", stick(0, 0), "http");
    expect(other).toEqual([AT_REST, { x: 0, y: -1, held: ["down"], buttons: [] }]);
    expect(heard).toEqual([AT_REST]);
  });

  it("survives a listener that throws", () => {
    const complaints = vi.spyOn(console, "error").mockImplementation(() => {});
    hub.subscribe("arcade", () => {
      throw new Error("the socket is gone");
    });
    expect(heldAfter(100, 0)).toEqual(["right"]);
    expect(complaints).toHaveBeenCalled();
    complaints.mockRestore();
  });
});

describe("hysteresis", () => {
  it("presses at 40 and lets go under 30, on each axis and side by itself", () => {
    expect(heldAfter(39, 0)).toEqual([]);
    expect(heldAfter(40, 0)).toEqual(["right"]);
    expect(heldAfter(30, 0)).toEqual(["right"]);
    expect(heldAfter(29, 0)).toEqual([]);
    expect(heldAfter(35, 0)).toEqual([]);

    expect(heldAfter(-40, -40)).toEqual(["left", "down"]);
    expect(heldAfter(-30, -29)).toEqual(["left"]);
    expect(heldAfter(0, 40)).toEqual(["up"]);
    expect(heldAfter(0, 30)).toEqual(["up"]);
    expect(heldAfter(0, 29)).toEqual([]);
  });

  it("swaps sides in one message when the stick is thrown across", () => {
    expect(heldAfter(100, 0)).toEqual(["right"]);
    expect(heldAfter(-100, 0)).toEqual(["left"]);
  });

  it("counts button A as up without confusing the stick's own up", () => {
    expect(heldAfter(0, 35, "a")).toEqual(["up"]);
    expect(heldAfter(0, 35)).toEqual([]);
    expect(heldAfter(0, 0, "b", "x", "y")).toEqual([]);
    expect(heard.at(-1)?.buttons).toEqual(["b", "x", "y"]);
  });
});

describe("silence", () => {
  it("lets go of everything after a second without a message", () => {
    hub.report("arcade", stick(100, 0, "b"), "udp");
    clock.advance(STALE_AFTER_MS - 1);
    expect(heard.at(-1)?.held).toEqual(["right"]);
    clock.advance(1);
    expect(heard.at(-1)).toEqual(AT_REST);
  });

  it("holds on for as long as the heartbeat keeps coming", () => {
    hub.report("arcade", stick(100, 0), "udp");
    for (let beat = 0; beat < 50; beat += 1) {
      clock.advance(100);
      hub.report("arcade", stick(100, 0), "udp");
    }
    expect(heard).toEqual([AT_REST, { x: 1, y: 0, held: ["right"], buttons: [] }]);
  });

  it("starts the hysteresis afresh after going stale", () => {
    hub.report("arcade", stick(100, 0), "udp");
    clock.advance(STALE_AFTER_MS);
    expect(heldAfter(35, 0)).toEqual([]);
  });

  it("says nothing new when a resting stick goes quiet", () => {
    hub.report("arcade", stick(0, 0), "udp");
    clock.advance(STALE_AFTER_MS);
    expect(heard).toEqual([AT_REST]);
  });
});

describe("list", () => {
  it("says who is connected, over what, and how long ago they spoke", () => {
    hub.report("arcade", stick(100, 0, "a"), "udp");
    clock.advance(250);
    hub.report("desk", stick(0, 0), "http");
    clock.advance(50);
    expect(hub.list()).toEqual([
      {
        id: "arcade",
        x: 1,
        y: 0,
        held: ["right", "up"],
        buttons: ["a"],
        transport: "udp",
        idleMs: 300,
      },
      { id: "desk", x: 0, y: 0, held: [], buttons: [], transport: "http", idleMs: 50 },
    ]);
  });

  it("forgets a controller that has been silent for a minute, but not its subscribers", () => {
    hub.report("arcade", stick(100, 0), "udp");
    clock.advance(FORGET_AFTER_MS - 1);
    expect(hub.list()).toEqual([
      { id: "arcade", ...AT_REST, transport: "udp", idleMs: FORGET_AFTER_MS - 1 },
    ]);
    clock.advance(1);
    expect(hub.list()).toEqual([]);
    expect(heldAfter(100, 0)).toEqual(["right"]);
  });
});

describe("close", () => {
  it("drops every timer and listener and ignores what comes after", () => {
    hub.report("arcade", stick(100, 0), "udp");
    hub.close();
    expect(clock.pendingTimers).toBe(0);
    hub.report("arcade", stick(0, 100), "udp");
    expect(hub.list()).toEqual([]);
    expect(heard).toHaveLength(2);
  });
});
