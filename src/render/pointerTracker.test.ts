import { describe, expect, it } from "vitest";
import { PointerTracker } from "./pointerTracker";

const pointer = (type: string, init: PointerEventInit): PointerEvent =>
  new PointerEvent(type, { isPrimary: true, pointerType: "touch", ...init });

const setup = () => {
  const canvas = document.createElement("canvas");
  return { canvas, tracker: new PointerTracker(canvas) };
};

describe("PointerTracker", () => {
  it("knows nothing until a pointer shows up", () => {
    expect(setup().tracker.client).toBeNull();
  });

  it("follows a finger while it is down and forgets it when it lifts", () => {
    const { canvas, tracker } = setup();

    canvas.dispatchEvent(pointer("pointerdown", { pointerId: 1, clientX: 10, clientY: 20 }));
    expect(tracker.client).toEqual({ x: 10, y: 20 });

    canvas.dispatchEvent(pointer("pointermove", { pointerId: 1, clientX: 44, clientY: 31 }));
    expect(tracker.client).toEqual({ x: 44, y: 31 });

    canvas.dispatchEvent(pointer("pointerup", { pointerId: 1, clientX: 44, clientY: 31 }));
    expect(tracker.client).toBeNull();
  });

  it("keeps a hovering mouse or pencil after it lifts, until it leaves the canvas", () => {
    const { canvas, tracker } = setup();
    const mouse = { pointerId: 7, pointerType: "mouse" };

    canvas.dispatchEvent(pointer("pointermove", { ...mouse, clientX: 5, clientY: 6 }));
    canvas.dispatchEvent(pointer("pointerdown", { ...mouse, clientX: 5, clientY: 6 }));
    canvas.dispatchEvent(pointer("pointerup", { ...mouse, clientX: 8, clientY: 9 }));
    expect(tracker.client).toEqual({ x: 5, y: 6 });

    canvas.dispatchEvent(pointer("pointerleave", mouse));
    expect(tracker.client).toBeNull();
  });

  it("forgets a cancelled pointer", () => {
    const { canvas, tracker } = setup();

    canvas.dispatchEvent(pointer("pointerdown", { pointerId: 3, pointerType: "pen" }));
    canvas.dispatchEvent(pointer("pointercancel", { pointerId: 3, pointerType: "pen" }));

    expect(tracker.client).toBeNull();
  });

  it("steps aside for a two-finger gesture until every finger has lifted", () => {
    const { canvas, tracker } = setup();
    const second = { pointerId: 2, isPrimary: false };

    canvas.dispatchEvent(pointer("pointerdown", { pointerId: 1, clientX: 10, clientY: 10 }));
    canvas.dispatchEvent(pointer("pointerdown", { ...second, clientX: 90, clientY: 90 }));
    expect(tracker.client).toBeNull();

    canvas.dispatchEvent(pointer("pointerup", second));
    canvas.dispatchEvent(pointer("pointermove", { pointerId: 1, clientX: 12, clientY: 12 }));
    expect(tracker.client).toBeNull();

    canvas.dispatchEvent(pointer("pointerup", { pointerId: 1 }));
    canvas.dispatchEvent(pointer("pointerdown", { pointerId: 4, clientX: 30, clientY: 40 }));
    expect(tracker.client).toEqual({ x: 30, y: 40 });
  });
});
