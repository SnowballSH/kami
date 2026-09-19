import { afterEach, describe, expect, it, vi } from "vitest";
import type { WalkIntent } from "../sim/types";
import { type Direction, WalkIntentMerger } from "../ui/walkIntent";
import { RemoteStick } from "./remoteStick";
import { FakeEventSource } from "./testing/fakeEventSource";

const attachStick = (controllerId = "arcade") => {
  const reports: Direction[][] = [];
  const stick = new RemoteStick((pressed) => reports.push([...pressed].sort()), {
    controllerId,
    openEventSource: (url) => new FakeEventSource(url),
  });
  const detach = stick.attach();
  return { reports, detach, source: FakeEventSource.latest() };
};

describe("RemoteStick", () => {
  afterEach(() => {
    FakeEventSource.opened.length = 0;
  });

  it("subscribes to the controller's events", () => {
    expect(attachStick().source.url).toBe("/api/controllers/arcade/events");
    expect(attachStick("left-stick").source.url).toBe("/api/controllers/left-stick/events");
  });

  it("opens nothing until it is attached", () => {
    new RemoteStick(vi.fn(), {
      controllerId: "arcade",
      openEventSource: (url) => new FakeEventSource(url),
    });

    expect(FakeEventSource.opened).toEqual([]);
  });

  it("passes the held directions through", () => {
    const { reports, source } = attachStick();

    source.sendState({ x: -0.7, y: 0.85, held: ["left", "up"] });
    source.sendState({ x: 1, y: 0, held: ["right"] });

    expect(reports).toEqual([["left", "up"], ["right"]]);
  });

  it("jumps on button A, and ignores the buttons that are not bound", () => {
    const { reports, source } = attachStick();

    source.sendState({ x: 0.6, held: ["right"], buttons: ["a"] });
    source.sendState({ x: 0.6, held: ["right"], buttons: ["b", "x", "y"] });

    expect(reports).toEqual([["right", "up"], ["right"]]);
  });

  it("reports only when what is pressed changes", () => {
    const { reports, source } = attachStick();

    source.sendState({});
    source.sendState({ x: 0.5, held: ["right"] });
    source.sendState({ x: 0.9, held: ["right"] });
    source.sendState({ x: 0.9, y: 1, held: ["up", "right"] });
    source.sendState({ x: 0.9, held: ["right"], buttons: ["a"] });
    source.sendState({ x: 0.2 });
    source.sendState({});

    expect(reports).toEqual([["right"], ["right", "up"], []]);
  });

  it("ignores malformed events and keeps what was pressed", () => {
    const { reports, source } = attachStick();

    source.sendState({ x: 1, held: ["right"] });
    source.send("not json");
    source.send('{"held":"left"}');
    source.send({ x: 0, y: 0, held: [], buttons: [] });
    source.send(undefined);

    expect(reports).toEqual([["right"]]);
  });

  it("lets go of everything on an error, and picks up again when the stream reconnects", () => {
    const { reports, source } = attachStick();

    source.sendState({ x: -1, held: ["left"] });
    source.fail();
    source.fail();
    source.sendState({ x: -1, held: ["left"] });

    expect(reports).toEqual([["left"], [], ["left"]]);
    expect(source.closed).toBe(false);
  });

  it("closes the stream and lets go when detached", () => {
    const { reports, detach, source } = attachStick();
    source.sendState({ y: -1, held: ["down"] });

    detach();

    expect(source.closed).toBe(true);
    expect(reports).toEqual([["down"], []]);
  });

  it("says nothing on detach when nothing was pressed", () => {
    const { reports, detach } = attachStick();

    detach();

    expect(reports).toEqual([]);
  });

  it("walks Alice as one more source of the merger", () => {
    const intents: WalkIntent[] = [];
    const walk = new WalkIntentMerger((intent) => intents.push(intent));
    const keyboard = walk.source();
    new RemoteStick(walk.source(), {
      controllerId: "arcade",
      openEventSource: (url) => new FakeEventSource(url),
    }).attach();
    const source = FakeEventSource.latest();

    source.sendState({ x: 1, held: ["right"] });
    keyboard(new Set(["right"]));
    source.sendState({});
    keyboard(new Set());
    source.sendState({ buttons: ["a"] });

    expect(intents).toEqual([
      { x: 1, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: -1 },
    ]);
  });
});
