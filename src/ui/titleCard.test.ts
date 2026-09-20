import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SANDBOX_MODE } from "../modes/sandboxMode";
import { TITLE_CARD_SHOWN_MS, TitleCard } from "./titleCard";

const pointer = (type: string): PointerEvent =>
  new PointerEvent(type, {
    pointerId: 3,
    pointerType: "touch",
    isPrimary: true,
    bubbles: true,
    cancelable: true,
  });

describe("TitleCard", () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("shows the mode's title and tagline, then fades on its own", () => {
    const card = new TitleCard();
    document.body.append(card.element);
    expect(card.showing).toBe(false);
    card.show(SANDBOX_MODE.card);
    expect(card.showing).toBe(true);
    expect(card.element.textContent).toContain("Sandbox");
    expect(card.element.textContent).toContain(SANDBOX_MODE.card.tagline);
    vi.advanceTimersByTime(TITLE_CARD_SHOWN_MS - 1);
    expect(card.element.classList.contains("is-fading")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(card.element.classList.contains("is-fading")).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(card.showing).toBe(false);
  });

  it("goes away sooner when tapped", () => {
    const card = new TitleCard();
    document.body.append(card.element);
    card.show(SANDBOX_MODE.card);
    card.element.dispatchEvent(pointer("pointerdown"));
    card.element.dispatchEvent(pointer("pointerup"));
    expect(card.element.classList.contains("is-fading")).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(card.showing).toBe(false);
  });

  it("starts over, unfaded, when shown again", () => {
    const card = new TitleCard();
    card.show(SANDBOX_MODE.card);
    vi.advanceTimersByTime(TITLE_CARD_SHOWN_MS);
    card.show({ ...SANDBOX_MODE.card, title: "Again" });
    expect(card.element.classList.contains("is-fading")).toBe(false);
    expect(card.element.textContent).toContain("Again");
    vi.advanceTimersByTime(TITLE_CARD_SHOWN_MS + 1_000);
    expect(card.showing).toBe(false);
  });
});
