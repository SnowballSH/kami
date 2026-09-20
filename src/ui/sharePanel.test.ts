import { afterEach, describe, expect, it, vi } from "vitest";
import { SharePanel } from "./sharePanel";
import type { ShareInfo } from "./types";

const SHARE: ShareInfo = {
  boardId: "together",
  link: "http://kami.test/?board=together&mode=sandbox",
  company: 0,
};

const find = <T extends Element>(root: Element, selector: string): T => {
  const match = root.querySelector<T>(selector);
  if (match === null) throw new Error(`Missing ${selector}`);
  return match;
};

const pointer = (type: string, init: PointerEventInit = {}): PointerEvent =>
  new PointerEvent(type, { pointerId: 3, bubbles: true, cancelable: true, ...init });

const tap = (target: Element): void => {
  target.dispatchEvent(pointer("pointerdown", { pointerType: "pen", isPrimary: true }));
  target.dispatchEvent(pointer("pointerup", { pointerType: "pen", isPrimary: true }));
};

describe("SharePanel", () => {
  const detachers: (() => void)[] = [];

  const setup = () => {
    const painted: string[] = [];
    const copied: string[] = [];
    const panel = new SharePanel(
      (_canvas, text) => {
        painted.push(text);
        return Promise.resolve();
      },
      (text) => {
        copied.push(text);
        return Promise.resolve();
      },
    );
    document.body.append(panel.element);
    detachers.push(panel.attach(document));
    const toggle = find<HTMLButtonElement>(panel.element, ".kami-share-toggle");
    const popover = find<HTMLElement>(panel.element, ".kami-share-popover");
    return { panel, toggle, popover, painted, copied };
  };

  afterEach(() => {
    for (const detach of detachers.splice(0)) detach();
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("stays hidden until there is a page to share, then shows its id, link and QR", () => {
    const { panel, popover, painted } = setup();
    expect(panel.element.hidden).toBe(true);
    panel.show(SHARE);
    expect(panel.element.hidden).toBe(false);
    expect(popover.hidden).toBe(true);
    expect(find(popover, ".kami-share-page").textContent).toBe("together");
    const link = find<HTMLAnchorElement>(popover, ".kami-share-link");
    expect(link.textContent).toBe(SHARE.link);
    expect(link.href).toBe(SHARE.link);
    expect(painted).toEqual([SHARE.link]);
  });

  it("repaints the QR only when the link changes, and keeps the company line current", () => {
    const { panel, popover, painted } = setup();
    panel.show(SHARE);
    panel.show({ ...SHARE, company: 1 });
    panel.show({ ...SHARE, company: 3 });
    expect(painted).toEqual([SHARE.link]);
    expect(find(popover, ".kami-share-company").textContent).toBe("3 others on this page.");
    panel.show({ ...SHARE, boardId: "elsewhere", link: "http://kami.test/?board=elsewhere" });
    expect(painted).toHaveLength(2);
  });

  it("opens on a tap, closes on Escape, a tap outside or another tap on the button", () => {
    const { panel, toggle, popover } = setup();
    panel.show(SHARE);
    tap(toggle);
    expect(popover.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(popover.hidden).toBe(true);
    tap(toggle);
    tap(popover);
    expect(popover.hidden).toBe(false);
    tap(document.body);
    expect(popover.hidden).toBe(true);
    tap(toggle);
    tap(toggle);
    expect(popover.hidden).toBe(true);
  });

  it("closes and hides when the page stops being shared", () => {
    const { panel, toggle, popover } = setup();
    panel.show(SHARE);
    tap(toggle);
    panel.show(null);
    expect(panel.element.hidden).toBe(true);
    expect(popover.hidden).toBe(true);
  });

  it("copies the link and says so for a moment", async () => {
    vi.useFakeTimers();
    const { panel, popover, copied } = setup();
    panel.show(SHARE);
    const copy = find<HTMLButtonElement>(popover, ".kami-share-copy");
    tap(copy);
    await Promise.resolve();
    expect(copied).toEqual([SHARE.link]);
    expect(copy.textContent).toBe("copied");
    vi.advanceTimersByTime(2_000);
    expect(copy.textContent).toBe("copy link");
  });
});
