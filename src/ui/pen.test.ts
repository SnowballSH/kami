import { describe, expect, it, vi } from "vitest";
import { attachPen } from "./index";
import type { PenSink } from "./types";

const WORLD_SCALE = 2;

const pointer = (type: string, init: PointerEventInit): PointerEvent =>
  new PointerEvent(type, { bubbles: true, cancelable: true, ...init });

const setup = () => {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const sink = { penDown: vi.fn(), penMove: vi.fn(), penUp: vi.fn() } satisfies PenSink;
  const detach = attachPen(canvas, (x, y) => ({ x: x * WORLD_SCALE, y: y * WORLD_SCALE }), sink);
  return { canvas, sink, detach };
};

describe("attachPen", () => {
  it("routes a stroke to the sink in world space", () => {
    const { canvas, sink } = setup();
    const down = pointer("pointerdown", { pointerId: 1, clientX: 10, clientY: 20 });

    canvas.dispatchEvent(down);
    canvas.dispatchEvent(pointer("pointermove", { pointerId: 1, clientX: 15, clientY: 25 }));
    canvas.dispatchEvent(pointer("pointerup", { pointerId: 1 }));

    expect(down.defaultPrevented).toBe(true);
    expect(sink.penDown).toHaveBeenCalledExactlyOnceWith({ x: 20, y: 40 });
    expect(sink.penMove).toHaveBeenCalledExactlyOnceWith({ x: 30, y: 50 });
    expect(sink.penUp).toHaveBeenCalledOnce();
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

    expect(sink.penMove.mock.calls.map(([point]) => point.x)).toEqual([22, 24, 26]);
  });

  it("ignores a second pointer until the first lifts", () => {
    const { canvas, sink } = setup();

    canvas.dispatchEvent(pointer("pointerdown", { pointerId: 1 }));
    canvas.dispatchEvent(pointer("pointerdown", { pointerId: 2, clientX: 99 }));
    canvas.dispatchEvent(pointer("pointermove", { pointerId: 2, clientX: 99 }));
    canvas.dispatchEvent(pointer("pointerup", { pointerId: 2 }));

    expect(sink.penDown).toHaveBeenCalledOnce();
    expect(sink.penMove).not.toHaveBeenCalled();
    expect(sink.penUp).not.toHaveBeenCalled();

    canvas.dispatchEvent(pointer("pointercancel", { pointerId: 1 }));
    canvas.dispatchEvent(pointer("pointerdown", { pointerId: 2 }));

    expect(sink.penUp).toHaveBeenCalledOnce();
    expect(sink.penDown).toHaveBeenCalledTimes(2);
  });

  it("ignores secondary mouse buttons", () => {
    const { canvas, sink } = setup();

    canvas.dispatchEvent(pointer("pointerdown", { pointerId: 1, pointerType: "mouse", button: 2 }));

    expect(sink.penDown).not.toHaveBeenCalled();
  });

  it("lifts the pen and stops listening once detached", () => {
    const { canvas, sink, detach } = setup();

    canvas.dispatchEvent(pointer("pointerdown", { pointerId: 1 }));
    detach();
    canvas.dispatchEvent(pointer("pointermove", { pointerId: 1, clientX: 5 }));
    canvas.dispatchEvent(pointer("pointerdown", { pointerId: 3 }));

    expect(sink.penUp).toHaveBeenCalledOnce();
    expect(sink.penMove).not.toHaveBeenCalled();
    expect(sink.penDown).toHaveBeenCalledOnce();
  });
});
