import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomCard } from "../modes/types";
import { ROOM_CARD_FADE_MS, RoomCardView } from "./roomCard";

const CARD: RoomCard = {
  mode: "Puzzle",
  title: "The Wall",
  line: "Too tall.",
  mark: "room 1 of 7",
};

describe("the room card", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the room as it opens, fades on its own, and keeps the mark", () => {
    vi.useFakeTimers();
    const view = new RoomCardView();
    view.show(CARD);
    expect(view.card.hidden).toBe(false);
    expect(view.card.textContent).toContain("Puzzle · room 1 of 7");
    expect(view.card.textContent).toContain("The Wall");
    expect(view.card.textContent).toContain("Too tall.");
    expect(view.mark.hidden).toBe(false);
    expect(view.mark.textContent).toBe("room 1 of 7");

    vi.advanceTimersByTime(5_000);
    expect(view.card.classList.contains("is-fading")).toBe(true);
    vi.advanceTimersByTime(ROOM_CARD_FADE_MS);
    expect(view.card.hidden).toBe(true);
    expect(view.mark.hidden).toBe(false);
  });

  it("dismisses on tap and keyboard activation", () => {
    vi.useFakeTimers();
    const view = new RoomCardView();
    view.show(CARD);
    view.card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    vi.advanceTimersByTime(ROOM_CARD_FADE_MS);
    expect(view.card.hidden).toBe(true);
    view.show(CARD);
    view.card.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    vi.advanceTimersByTime(ROOM_CARD_FADE_MS);
    expect(view.card.hidden).toBe(true);
  });

  it("starts afresh for the next room, and clears for a board with no card", () => {
    vi.useFakeTimers();
    const view = new RoomCardView();
    view.show(CARD);
    vi.advanceTimersByTime(4_000);
    view.show({ ...CARD, title: "The Keyhole", mark: "room 2 of 7" });
    vi.advanceTimersByTime(4_000);
    expect(view.card.hidden).toBe(false);
    expect(view.card.classList.contains("is-fading")).toBe(false);
    expect(view.card.textContent).toContain("The Keyhole");

    view.show(null);
    expect(view.card.hidden).toBe(true);
    expect(view.mark.hidden).toBe(true);
  });
});
