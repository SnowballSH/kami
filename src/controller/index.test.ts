import { afterEach, describe, expect, it, vi } from "vitest";
import type { Direction } from "../ui/walkIntent";
import { createRemoteStick } from "./index";
import { FakeEventSource } from "./testing/fakeEventSource";

const visit = (search: string): void => {
  window.history.replaceState(null, "", `${window.location.pathname}${search}`);
};

describe("createRemoteStick", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeEventSource.opened.length = 0;
    visit("");
  });

  it("is null, without throwing, where there is no EventSource", () => {
    vi.stubGlobal("EventSource", undefined);

    expect(createRemoteStick(vi.fn())).toBeNull();
  });

  it("listens to the arcade stick by default", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const reports: Direction[][] = [];

    const detach = createRemoteStick((pressed) => reports.push([...pressed]))?.attach();
    const source = FakeEventSource.latest();
    source.sendState({ x: 1, held: ["right"] });
    detach?.();

    expect(source.url).toBe("/api/controllers/arcade/events");
    expect(reports).toEqual([["right"], []]);
    expect(source.closed).toBe(true);
  });

  it("listens to the stick ?controller= names", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    visit("?board=wonderland&controller=stick-2");

    createRemoteStick(vi.fn())?.attach();

    expect(FakeEventSource.latest().url).toBe("/api/controllers/stick-2/events");
  });

  it("is null for ?controller=off", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    visit("?controller=off");

    expect(createRemoteStick(vi.fn())).toBeNull();
    expect(FakeEventSource.opened).toEqual([]);
  });
});
