import { afterEach, describe, expect, it, vi } from "vitest";
import { attachCanvasInput } from "./index";
import type { CanvasInputSink, Tool } from "./types";

const pointer = (type: string, init: PointerEventInit): PointerEvent =>
  new PointerEvent(type, { bubbles: true, cancelable: true, ...init });

const wheel = (init: WheelEventInit): WheelEvent => {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
  const mouseFieldsHappyDomOmits = {
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
  };
  for (const [field, value] of Object.entries(mouseFieldsHappyDomOmits)) {
    Object.defineProperty(event, field, { value });
  }
  return event;
};

const createSink = () =>
  ({
    penDown: vi.fn(),
    penMove: vi.fn(),
    penUp: vi.fn(),
    penCancel: vi.fn(),
    tap: vi.fn(),
    panBy: vi.fn(),
    zoomAt: vi.fn(),
    undo: vi.fn(),
  }) satisfies CanvasInputSink;

const setup = (tool: Tool = "draw") => {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const sink = createSink();
  const detach = attachCanvasInput(canvas, () => tool, sink);
  return { canvas, sink, detach };
};

describe("attachCanvasInput", () => {
  afterEach(() => document.body.replaceChildren());

  it("routes a stroke to the sink in client coordinates and owns the events", () => {
    const { canvas, sink } = setup();
    const down = pointer("pointerdown", { pointerId: 1, clientX: 10, clientY: 20 });

    canvas.dispatchEvent(down);
    canvas.dispatchEvent(pointer("pointermove", { pointerId: 1, clientX: 40, clientY: 25 }));
    canvas.dispatchEvent(pointer("pointerup", { pointerId: 1, clientX: 40, clientY: 25 }));

    expect(down.defaultPrevented).toBe(true);
    expect(sink.penDown).toHaveBeenCalledExactlyOnceWith({ x: 10, y: 20 });
    expect(sink.penMove).toHaveBeenCalledExactlyOnceWith({ x: 40, y: 25 });
    expect(sink.penUp).toHaveBeenCalledOnce();
    expect(sink.tap).not.toHaveBeenCalled();
  });

  it("feeds every coalesced sample to the sink", () => {
    const { canvas, sink } = setup();
    const samples = [11, 12, 13].map((clientX) =>
      pointer("pointermove", { pointerId: 1, clientX, clientY: 0 }),
    );

    canvas.dispatchEvent(pointer("pointerdown", { pointerId: 1 }));
    canvas.dispatchEvent(
      pointer("pointermove", { pointerId: 1, clientX: 13, coalescedEvents: samples }),
    );

    expect(sink.penMove.mock.calls.map(([point]) => point.x)).toEqual([11, 12, 13]);
  });

  it("reports a still press as a cancelled pen and a tap", () => {
    const { canvas, sink } = setup("erase");

    canvas.dispatchEvent(pointer("pointerdown", { pointerId: 1, clientX: 7, clientY: 9 }));
    canvas.dispatchEvent(pointer("pointerup", { pointerId: 1, clientX: 7, clientY: 9 }));

    expect(sink.penCancel).toHaveBeenCalledOnce();
    expect(sink.tap).toHaveBeenCalledExactlyOnceWith({ x: 7, y: 9 });
    expect(sink.penUp).not.toHaveBeenCalled();
  });

  it("pinches with two touch pointers", () => {
    const { canvas, sink } = setup();
    const touch = { pointerType: "touch" } as const;

    canvas.dispatchEvent(pointer("pointerdown", { ...touch, pointerId: 1, clientX: 0 }));
    canvas.dispatchEvent(pointer("pointerdown", { ...touch, pointerId: 2, clientX: 100 }));
    canvas.dispatchEvent(pointer("pointermove", { ...touch, pointerId: 2, clientX: 300 }));

    expect(sink.penCancel).toHaveBeenCalledOnce();
    expect(sink.panBy).toHaveBeenCalledExactlyOnceWith({ x: 100, y: 0 });
    expect(sink.zoomAt).toHaveBeenCalledExactlyOnceWith({ x: 150, y: 0 }, 3);
  });

  it("commits whatever is being typed when the board is pressed", () => {
    const { canvas } = setup();
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();

    canvas.dispatchEvent(pointer("pointerdown", { pointerId: 1 }));

    expect(document.activeElement).not.toBe(field);
  });

  it("pans with the wheel and zooms with ctrl-wheel, never scrolling the page", () => {
    const { canvas, sink } = setup();
    const scroll = wheel({ deltaX: 3, deltaY: 12, clientX: 50, clientY: 60 });
    const lines = wheel({ deltaY: 2, deltaMode: 1 });
    const pinch = wheel({ deltaY: -10, ctrlKey: true, clientX: 50, clientY: 60 });

    canvas.dispatchEvent(scroll);
    canvas.dispatchEvent(lines);
    canvas.dispatchEvent(pinch);

    expect(scroll.defaultPrevented).toBe(true);
    expect(sink.panBy.mock.calls).toEqual([[{ x: -3, y: -12 }], [{ x: -0, y: -32 }]]);
    expect(sink.zoomAt).toHaveBeenCalledOnce();
    expect(sink.zoomAt.mock.calls[0]?.[0]).toEqual({ x: 50, y: 60 });
    expect(sink.zoomAt.mock.calls[0]?.[1]).toBeGreaterThan(1);
  });

  it("drops the stroke in progress and stops listening once detached", () => {
    const { canvas, sink, detach } = setup();

    canvas.dispatchEvent(pointer("pointerdown", { pointerId: 1 }));
    detach();
    canvas.dispatchEvent(pointer("pointermove", { pointerId: 1, clientX: 50 }));
    canvas.dispatchEvent(pointer("pointerdown", { pointerId: 3 }));
    canvas.dispatchEvent(wheel({ deltaY: 10 }));

    expect(sink.penDown).toHaveBeenCalledOnce();
    expect(sink.penCancel).toHaveBeenCalledOnce();
    expect(sink.penMove).not.toHaveBeenCalled();
    expect(sink.panBy).not.toHaveBeenCalled();
  });
});
