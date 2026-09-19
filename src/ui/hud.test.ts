import { afterEach, describe, expect, it, vi } from "vitest";
import type { WalkIntent } from "../sim/types";
import { DomHud } from "./hud";
import type { HudHandlers } from "./types";

const GUESSES = ["a mushroom", "a rock", "a cloud"] as const;

const createHandlers = () =>
  ({
    onWalkIntent: vi.fn<(intent: WalkIntent) => void>(),
    onNameChosen: vi.fn(),
    onNamingDismissed: vi.fn(),
    onAskCat: vi.fn(),
    onEraserToggled: vi.fn(),
    onResetRoom: vi.fn(),
  }) satisfies HudHandlers;

const find = <T extends Element>(root: Element, selector: string): T => {
  const match = root.querySelector<T>(selector);
  if (match === null) throw new Error(`Missing ${selector}`);
  return match;
};

const pointer = (type: string, pointerId: number): PointerEvent =>
  new PointerEvent(type, { pointerId, bubbles: true, cancelable: true });

const key = (type: "keydown" | "keyup", code: string): KeyboardEvent =>
  new KeyboardEvent(type, { code, bubbles: true, cancelable: true });

const intents = (handlers: ReturnType<typeof createHandlers>): readonly WalkIntent[] =>
  handlers.onWalkIntent.mock.calls.map(([intent]) => intent);

describe("DomHud", () => {
  const huds: DomHud[] = [];

  const setup = () => {
    const root = document.createElement("div");
    document.body.append(root);
    const handlers = createHandlers();
    const hud = new DomHud(root, handlers);
    huds.push(hud);
    return { root, handlers, hud };
  };

  afterEach(() => {
    for (const hud of huds.splice(0)) hud.dispose();
    document.body.replaceChildren();
  });

  describe("naming panel", () => {
    it("opens with one chip per guess and reports the tapped one", () => {
      const { root, handlers, hud } = setup();
      expect(hud.namingOpen).toBe(false);

      hud.showNaming(GUESSES);
      const chips = [...root.querySelectorAll<HTMLButtonElement>(".kami-chip")];

      expect(hud.namingOpen).toBe(true);
      expect(chips.map((chip) => chip.textContent)).toEqual([...GUESSES]);

      chips[1]?.click();

      expect(handlers.onNameChosen).toHaveBeenCalledExactlyOnceWith("a rock");
      expect(hud.namingOpen).toBe(false);
    });

    it("submits the typed name trimmed and ignores blank ones", () => {
      const { root, handlers, hud } = setup();
      hud.showNaming(GUESSES);
      const form = find<HTMLFormElement>(root, ".kami-naming-form");
      const input = find<HTMLInputElement>(root, ".kami-naming-input");

      input.value = "   ";
      form.dispatchEvent(new Event("submit", { cancelable: true }));
      expect(handlers.onNameChosen).not.toHaveBeenCalled();
      expect(hud.namingOpen).toBe(true);

      input.value = "  a very bouncy mushroom ";
      form.dispatchEvent(new Event("submit", { cancelable: true }));
      expect(handlers.onNameChosen).toHaveBeenCalledExactlyOnceWith("a very bouncy mushroom");
      expect(hud.namingOpen).toBe(false);
    });

    it("is hardened against Safari's zoom and autocorrect", () => {
      const { root } = setup();
      const input = find<HTMLInputElement>(root, ".kami-naming-input");

      expect(input.getAttribute("enterkeyhint")).toBe("done");
      expect(input.getAttribute("autocapitalize")).toBe("off");
      expect(input.getAttribute("autocomplete")).toBe("off");
    });

    it("dismisses with 'just ink' and closes on request", () => {
      const { root, handlers, hud } = setup();

      hud.showNaming(GUESSES);
      find<HTMLButtonElement>(root, ".kami-naming-dismiss").click();
      expect(handlers.onNamingDismissed).toHaveBeenCalledOnce();
      expect(hud.namingOpen).toBe(false);

      hud.showNaming(GUESSES);
      hud.hideNaming();
      expect(hud.namingOpen).toBe(false);
      expect(handlers.onNamingDismissed).toHaveBeenCalledOnce();
    });
  });

  describe("walking", () => {
    it("holds and releases a d-pad direction per pointer", () => {
      const { root, handlers } = setup();
      const right = find<HTMLButtonElement>(root, ".kami-dpad-right");
      const up = find<HTMLButtonElement>(root, ".kami-dpad-up");

      right.dispatchEvent(pointer("pointerdown", 1));
      up.dispatchEvent(pointer("pointerdown", 2));
      right.dispatchEvent(pointer("pointerup", 1));
      right.dispatchEvent(pointer("lostpointercapture", 1));
      up.dispatchEvent(pointer("pointercancel", 2));

      expect(intents(handlers)).toEqual([
        { x: 1, y: 0 },
        { x: 1, y: -1 },
        { x: 0, y: -1 },
        { x: 0, y: 0 },
      ]);
    });

    it("walks with arrows and WASD, cancelling opposites across inputs", () => {
      const { root, handlers } = setup();
      const left = find<HTMLButtonElement>(root, ".kami-dpad-left");

      window.dispatchEvent(key("keydown", "ArrowRight"));
      window.dispatchEvent(key("keydown", "ArrowRight"));
      left.dispatchEvent(pointer("pointerdown", 1));
      left.dispatchEvent(pointer("lostpointercapture", 1));
      window.dispatchEvent(key("keyup", "ArrowRight"));
      window.dispatchEvent(key("keydown", "KeyS"));
      window.dispatchEvent(new Event("blur"));

      expect(intents(handlers)).toEqual([
        { x: 1, y: 0 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: 0 },
      ]);
    });

    it("does not walk while keys are typed into the naming input", () => {
      const { root, handlers, hud } = setup();
      hud.showNaming(GUESSES);
      const input = find<HTMLInputElement>(root, ".kami-naming-input");

      input.dispatchEvent(key("keydown", "KeyD"));
      input.dispatchEvent(key("keyup", "KeyD"));
      input.dispatchEvent(key("keydown", "ArrowLeft"));

      expect(handlers.onWalkIntent).not.toHaveBeenCalled();
    });
  });

  describe("top bar", () => {
    it("drains the ink bar and flags it under fifteen percent", () => {
      const { root, hud } = setup();
      const meter = find<HTMLElement>(root, ".kami-ink");
      const fill = find<HTMLElement>(root, ".kami-ink-fill");

      hud.setInk({ total: 600, remaining: 300 });
      expect(fill.style.width).toBe("50.0%");
      expect(meter.classList.contains("is-low")).toBe(false);

      hud.setInk({ total: 600, remaining: 60 });
      expect(fill.style.width).toBe("10.0%");
      expect(meter.classList.contains("is-low")).toBe(true);

      hud.setInk({ total: 0, remaining: 0 });
      expect(fill.style.width).toBe("0.0%");
    });

    it("reports eraser toggles and reflects the state it is given", () => {
      const { root, handlers, hud } = setup();
      const eraser = find<HTMLButtonElement>(root, ".kami-eraser");

      eraser.click();
      expect(handlers.onEraserToggled).toHaveBeenLastCalledWith(true);
      expect(eraser.getAttribute("aria-pressed")).toBe("true");

      hud.setEraserActive(false);
      expect(eraser.getAttribute("aria-pressed")).toBe("false");
      expect(handlers.onEraserToggled).toHaveBeenCalledOnce();

      eraser.click();
      eraser.click();
      expect(handlers.onEraserToggled.mock.calls).toEqual([[true], [true], [false]]);
    });

    it("shows the room as a page of the book and forwards reset and ask", () => {
      const { root, handlers, hud } = setup();

      hud.setRoom("The Shelves", 2, 3);
      find<HTMLButtonElement>(root, ".kami-reset").click();
      find<HTMLButtonElement>(root, ".kami-ask").click();

      expect(find(root, ".kami-room-title").textContent).toBe("The Shelves");
      expect(find(root, ".kami-room-page").textContent).toBe("page 2 of 3");
      expect(handlers.onResetRoom).toHaveBeenCalledOnce();
      expect(handlers.onAskCat).toHaveBeenCalledOnce();
    });
  });

  describe("the Cat", () => {
    it("captions a line and fades it out later, longer for longer lines", () => {
      vi.useFakeTimers();
      const { root, hud } = setup();
      const bubble = find<HTMLElement>(root, ".kami-cat");

      hud.say("Ask, if you like.");
      expect(bubble.classList.contains("is-shown")).toBe(true);
      expect(find(root, ".kami-cat-caption").textContent).toBe("Ask, if you like.");

      vi.advanceTimersByTime(3000);
      expect(bubble.classList.contains("is-shown")).toBe(true);
      vi.advanceTimersByTime(3000);
      expect(bubble.classList.contains("is-shown")).toBe(false);
      vi.useRealTimers();
    });
  });

  describe("title card", () => {
    it("resolves once the card has faded back out", async () => {
      vi.useFakeTimers();
      const { root, hud } = setup();
      const card = find<HTMLElement>(root, ".kami-title");
      const done = vi.fn();

      void hud.showTitleCard({ title: "Kami", durationMs: 2000 }).then(done);
      expect(card.classList.contains("is-shown")).toBe(true);
      expect(find(root, ".kami-title-heading").textContent).toBe("Kami");

      await vi.advanceTimersByTimeAsync(1900);
      expect(done).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);
      expect(done).toHaveBeenCalledOnce();
      expect(card.classList.contains("is-shown")).toBe(false);
      vi.useRealTimers();
    });
  });
});
