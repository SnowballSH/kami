// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RemoteStick } from "../../src/controller/remoteStick";
import { FakeEventSource } from "../../src/controller/testing/fakeEventSource";
import type { WalkIntent } from "../../src/sim/types";
import { WalkIntentMerger } from "../../src/ui/walkIntent";
import { parseCabinetLine } from "./cabinet";
import { InMemoryControllerHub, STALE_AFTER_MS } from "./hub";
import { LineBuffer, reportLines } from "./lines";
import { ManualClock } from "./testing/manualClock";

describe("cabinet serial protocol", () => {
  it.each([
    [0, 0, 0],
    [1, -100, 0],
    [2, 100, 0],
    [4, 0, 100],
    [8, 0, -100],
    [5, -100, 100],
    [10, 100, -100],
    [15, 0, 0],
  ])("maps microswitch mask %i to axes, cancelling opposite switches", (mask, x, y) => {
    expect(parseCabinetLine(`S,${mask},0,0,0,4095`)).toEqual({
      controller: "arcade",
      reading: { x, y, buttons: [] },
    });
  });

  it("keeps INK/CAT unbound and never uses pen knobs to walk or jump", () => {
    expect(parseCabinetLine("S,0,1,1,4095,4095")).toEqual({
      controller: "arcade",
      reading: { x: 0, y: 0, buttons: ["b", "x"] },
    });
    expect(parseCabinetLine("S,0,0,1,0,0")?.reading.buttons).toEqual(["x"]);
    expect(parseCabinetLine("S,0,1,0,0,0")?.reading.buttons).toEqual(["b"]);
  });

  it.each([
    "S,16,0,0,0,0",
    "S,-1,0,0,0,0",
    "S,1.5,0,0,0,0",
    "S,1,2,0,0,0",
    "S,1,0,-1,0,0",
    "S,1,0,0,4096,0",
    "S,1,0,0,0,4096",
    "S,1,0,0,-1,0",
    "S,1,0,0,0,1e2",
    "S,1,0,0,NaN,0",
    "S,1,0,0,1.5,0",
    "S,1,0,0,,0",
    "S,1,0,0,0",
    "S,1,0,0,0,0,0",
    "S,1,0,0,0,0\u0000",
    "booting",
  ])("drops invalid frames: %s", (line) => {
    expect(parseCabinetLine(line)).toBeNull();
  });

  it("accepts split frames only on serial and keeps the named-controller protocol", () => {
    const hub = new InMemoryControllerHub(new ManualClock());
    const buffer = new LineBuffer();
    for (const transport of ["udp", "http"] as const) {
      reportLines(hub, ["S,1,0,0,0,0"], transport);
    }
    expect(hub.list()).toEqual([]);
    reportLines(hub, buffer.push("S,6,1"), "serial");
    expect(hub.list()).toEqual([]);
    reportLines(hub, buffer.push(",0,2048,4095\r\nkami other -100 0 A\n"), "serial");
    expect(hub.list()).toEqual([
      {
        id: "arcade",
        x: 1,
        y: 1,
        held: ["right", "up"],
        buttons: ["b"],
        transport: "serial",
        idleMs: 0,
      },
      {
        id: "other",
        x: -1,
        y: 0,
        held: ["left", "up"],
        buttons: ["a"],
        transport: "serial",
        idleMs: 0,
      },
    ]);
    hub.close();
  });

  it("releases stale cabinet input, resumes on reconnect, and preserves keyboard fallback", () => {
    const clock = new ManualClock();
    const hub = new InMemoryControllerHub(clock);
    const intents: WalkIntent[] = [];
    const walk = new WalkIntentMerger((intent) => intents.push(intent));
    const keyboard = walk.source();
    const source = new FakeEventSource("/api/controllers/arcade/events");
    const detach = new RemoteStick(walk.source(), {
      controllerId: "arcade",
      openEventSource: () => source,
    }).attach();
    const unsubscribe = hub.subscribe("arcade", (state) => source.send(JSON.stringify(state)));
    const buffer = new LineBuffer();
    const receive = (chunk: string) => reportLines(hub, buffer.push(chunk), "serial");
    receive("S,2,0,0,0,0\n");
    expect(intents.at(-1)).toEqual({ x: 1, y: 0 });
    clock.advance(STALE_AFTER_MS - 1);
    receive(`${"x".repeat(257)}S,2,0,0,0,0\nS,16,0,0,0,0\n`);
    clock.advance(1);
    expect(intents.at(-1)).toEqual({ x: 0, y: 0 });
    receive("S,1,0,0,0,0\n");
    expect(intents.at(-1)).toEqual({ x: -1, y: 0 });
    keyboard(new Set(["right"]));
    source.fail();
    expect(intents.at(-1)).toEqual({ x: 1, y: 0 });
    receive("S,8,0,0,0,0\n");
    expect(intents.at(-1)).toEqual({ x: 1, y: 1 });
    unsubscribe();
    detach();
    hub.close();
    FakeEventSource.opened.length = 0;
  });
});
