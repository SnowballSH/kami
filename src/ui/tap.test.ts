import { describe, expect, it, vi } from "vitest";
import { onTap } from "./tap";

const pointer = (
  type: string,
  init: Partial<PointerEventInit> & { pointerId: number },
  timeStamp?: number,
): PointerEvent => {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, ...init });
  if (timeStamp !== undefined) Object.defineProperty(event, "timeStamp", { value: timeStamp });
  return event;
};

const click = (timeStamp: number): MouseEvent => {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "timeStamp", { value: timeStamp });
  return event;
};

const setup = () => {
  const button = document.createElement("button");
  document.body.append(button);
  const activate = vi.fn();
  onTap(button, activate);
  return { button, activate };
};

describe("onTap", () => {
  it("activates on pen pointer-up and swallows the click the browser sends afterwards", () => {
    const { button, activate } = setup();

    button.dispatchEvent(pointer("pointerdown", { pointerId: 3, pointerType: "pen" }, 1000));
    button.dispatchEvent(pointer("pointerup", { pointerId: 3, pointerType: "pen" }, 1100));
    button.dispatchEvent(click(1400));

    expect(activate).toHaveBeenCalledOnce();
  });

  it("still activates on a click with no pointer history (keyboard)", () => {
    const { button, activate } = setup();
    button.dispatchEvent(click(5000));
    expect(activate).toHaveBeenCalledOnce();
  });

  it("ignores a second pointer while one is held, and a cancelled pointer", () => {
    const { button, activate } = setup();

    button.dispatchEvent(pointer("pointerdown", { pointerId: 1, pointerType: "touch" }));
    button.dispatchEvent(pointer("pointerdown", { pointerId: 2, pointerType: "touch" }));
    button.dispatchEvent(pointer("pointerup", { pointerId: 2, pointerType: "touch" }));
    expect(activate).not.toHaveBeenCalled();

    button.dispatchEvent(pointer("pointercancel", { pointerId: 1, pointerType: "touch" }));
    expect(activate).not.toHaveBeenCalled();
  });

  it("does not activate when the pointer slid off before lifting", () => {
    const { button, activate } = setup();

    button.dispatchEvent(pointer("pointerdown", { pointerId: 1, clientX: 0, clientY: 0 }));
    button.dispatchEvent(pointer("pointerup", { pointerId: 1, clientX: 30, clientY: 0 }));

    expect(activate).not.toHaveBeenCalled();
  });

  it("leaves taps on a nested button to that button", () => {
    const cover = document.createElement("div");
    const inner = document.createElement("button");
    cover.append(inner);
    document.body.append(cover);
    const coverTap = vi.fn();
    const innerTap = vi.fn();
    onTap(cover, coverTap);
    onTap(inner, innerTap);

    inner.dispatchEvent(pointer("pointerdown", { pointerId: 1 }, 100));
    inner.dispatchEvent(pointer("pointerup", { pointerId: 1 }, 150));
    inner.dispatchEvent(click(300));

    expect(innerTap).toHaveBeenCalledOnce();
    expect(coverTap).not.toHaveBeenCalled();
  });

  it("ignores secondary mouse buttons", () => {
    const { button, activate } = setup();
    button.dispatchEvent(pointer("pointerdown", { pointerId: 1, pointerType: "mouse", button: 2 }));
    button.dispatchEvent(pointer("pointerup", { pointerId: 1, pointerType: "mouse", button: 2 }));
    expect(activate).not.toHaveBeenCalled();
  });
});
