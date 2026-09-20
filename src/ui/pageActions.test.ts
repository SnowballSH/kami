import { afterEach, describe, expect, it, vi } from "vitest";
import { homeUrl, PageActions } from "./pageActions";

const find = <T extends Element>(root: Element, selector: string): T => {
  const match = root.querySelector<T>(selector);
  if (match === null) throw new Error(`Missing ${selector}`);
  return match;
};

const setup = () => {
  const cleared = vi.fn();
  const wentHome = vi.fn();
  const actions = new PageActions({ onClearBoard: cleared }, wentHome);
  document.body.append(actions.element);
  const detach = actions.attach(document);
  return {
    cleared,
    wentHome,
    detach,
    home: find<HTMLButtonElement>(actions.element, ".kami-page-home"),
    clear: find<HTMLButtonElement>(actions.element, ".kami-page-clear"),
  };
};

describe("PageActions", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("goes back to the start on one tap", () => {
    const { home, wentHome, cleared } = setup();
    home.click();
    expect(wentHome).toHaveBeenCalledTimes(1);
    expect(cleared).not.toHaveBeenCalled();
  });

  it("clears only on a second tap, and says so in between", () => {
    const { clear, cleared } = setup();
    clear.click();
    expect(cleared).not.toHaveBeenCalled();
    expect(clear.classList.contains("is-confirming")).toBe(true);
    expect(clear.getAttribute("aria-label")).toBe("Tap again to clear");
    clear.click();
    expect(cleared).toHaveBeenCalledTimes(1);
    expect(clear.classList.contains("is-confirming")).toBe(false);
  });

  it("stands down when the player taps elsewhere, presses Escape, or waits", () => {
    vi.useFakeTimers();
    const { clear, cleared } = setup();
    clear.click();
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(clear.classList.contains("is-confirming")).toBe(false);
    clear.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(clear.classList.contains("is-confirming")).toBe(false);
    clear.click();
    vi.advanceTimersByTime(3000);
    expect(clear.classList.contains("is-confirming")).toBe(false);
    clear.click();
    expect(cleared).not.toHaveBeenCalled();
  });

  it("names the start screen: this page without mode, board or anything else", () => {
    expect(homeUrl({ origin: "http://box:8787", pathname: "/" })).toBe("http://box:8787/");
  });
});
