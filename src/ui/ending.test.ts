import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENDING_ADVANCE_MS, EndingView } from "./ending";
import type { EndingEntry } from "./types";

const entry = (name: string): EndingEntry => ({
  name,
  thumbnail: document.createElement("canvas"),
});

const find = <T extends Element>(root: Element, selector: string): T => {
  const match = root.querySelector<T>(selector);
  if (match === null) throw new Error(`Missing ${selector}`);
  return match;
};

describe("EndingView", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("flips through one drawing at a time, by timer or by tap, then offers a restart", () => {
    const view = new EndingView();
    const entries = [entry("a bouncy mushroom"), entry("a ladder"), entry("a cake")];
    const caption = find<HTMLElement>(view.element, ".kami-ending-caption");
    const frame = find<HTMLElement>(view.element, ".kami-ending-frame");
    const restart = find<HTMLButtonElement>(view.element, ".kami-ending-restart");

    view.show(entries, vi.fn());
    expect(caption.textContent).toBe("a bouncy mushroom");
    expect([...frame.children]).toEqual([entries[0]?.thumbnail]);
    expect(restart.hidden).toBe(true);

    vi.advanceTimersByTime(ENDING_ADVANCE_MS);
    expect(caption.textContent).toBe("a ladder");

    view.element.click();
    expect(caption.textContent).toBe("a cake");
    expect([...frame.children]).toEqual([entries[2]?.thumbnail]);

    vi.advanceTimersByTime(ENDING_ADVANCE_MS);
    expect(restart.hidden).toBe(false);
    expect(frame.hidden).toBe(true);
  });

  it("goes straight to the restart when nothing was drawn", () => {
    const view = new EndingView();
    const onRestart = vi.fn();
    const restart = find<HTMLButtonElement>(view.element, ".kami-ending-restart");

    view.show([], onRestart);
    expect(restart.hidden).toBe(false);

    restart.click();
    expect(onRestart).toHaveBeenCalledOnce();
    expect(view.element.classList.contains("is-shown")).toBe(false);
  });

  it("stops turning pages once hidden", () => {
    const view = new EndingView();
    const caption = find<HTMLElement>(view.element, ".kami-ending-caption");

    view.show([entry("a plank"), entry("a rock")], vi.fn());
    view.hide();
    vi.advanceTimersByTime(ENDING_ADVANCE_MS * 3);

    expect(caption.textContent).toBe("a plank");
  });
});
