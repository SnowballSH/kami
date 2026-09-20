import { afterEach, describe, expect, it, vi } from "vitest";
import { INPUT_LIMITS, TEXT_LIMIT_MESSAGE } from "../core/inputLimits";
import type { WalkIntent } from "../sim/types";
import { DomHud } from "./hud";
import type { BoardListing, HudHandlers, Tool } from "./types";
import { ZOOM_STEP } from "./zoomControls";

const BOARDS: readonly BoardListing[] = [
  { id: "wonderland", title: "Wonderland" },
  { id: "moon-golf", title: "Moon golf" },
];

const createHandlers = () =>
  ({
    onWalkIntent: vi.fn<(intent: WalkIntent) => void>(),
    onToolChanged: vi.fn<(tool: Tool) => void>(),
    onZoom: vi.fn<(factor: number) => void>(),
    onRecenter: vi.fn(),
    onAutopilotToggled: vi.fn<(enabled: boolean) => void>(),
    onTidinessChanged: vi.fn<(tidiness: number) => void>(),
    onOpenBoard: vi.fn<(boardId: string) => void>(),
    onNewBoard: vi.fn(),
    onClearBoard: vi.fn(),
    onRetryPersistence: vi.fn(),
    onTalkStarted: vi.fn(),
    onTalkEnded: vi.fn(),
    onWakeToggled: vi.fn<(enabled: boolean) => void>(),
  }) satisfies HudHandlers;

const find = <T extends Element>(root: Element, selector: string): T => {
  const match = root.querySelector<T>(selector);
  if (match === null) throw new Error(`Missing ${selector}`);
  return match;
};

const pointer = (type: string, pointerId: number, init: PointerEventInit = {}): PointerEvent =>
  new PointerEvent(type, { pointerId, bubbles: true, cancelable: true, ...init });

/** A pen or finger tap as Safari delivers it: pointer down, up, then a click echoing the tap. */
const tap = (target: Element, pointerType: "pen" | "touch" | "mouse" = "pen"): void => {
  target.dispatchEvent(pointer("pointerdown", 7, { pointerType, isPrimary: true }));
  target.dispatchEvent(pointer("pointerup", 7, { pointerType, isPrimary: true }));
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
};

const key = (type: "keydown" | "keyup", init: KeyboardEventInit): KeyboardEvent =>
  new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });

const press = (target: EventTarget, init: KeyboardEventInit): void => {
  target.dispatchEvent(key("keydown", init));
  target.dispatchEvent(key("keyup", init));
};

describe("DomHud", () => {
  const huds: DomHud[] = [];

  const setup = () => {
    const root = document.createElement("div");
    document.body.append(root);
    const handlers = createHandlers();
    const hud = new DomHud(root, handlers);
    huds.push(hud);
    const pressedTools = (): readonly string[] =>
      [...root.querySelectorAll(".kami-tool[aria-pressed='true']")].map(
        (button) => button.className,
      );
    const prompt = find<HTMLInputElement>(root, ".kami-prompt");
    return { root, handlers, hud, pressedTools, prompt };
  };

  afterEach(() => {
    for (const hud of huds.splice(0)) hud.dispose();
    document.body.replaceChildren();
  });

  describe("toolbar", () => {
    it("reports its current bottom edge for canvas writing placement", () => {
      const { root, hud } = setup();
      const toolbar = find<HTMLElement>(root, ".kami-toolbar");
      const rect = vi.spyOn(toolbar, "getBoundingClientRect");
      rect.mockReturnValue(new DOMRect(100, 32, 240, 50));
      expect(hud.toolbarBottom()).toBe(82);
      rect.mockReturnValue(new DOMRect(100, 48, 240, 70));
      expect(hud.toolbarBottom()).toBe(118);
    });

    it("starts on draw and reports the tool a button picks", () => {
      const { root, handlers, pressedTools } = setup();
      expect(pressedTools()).toEqual([expect.stringContaining("kami-tool-draw")]);

      find<HTMLButtonElement>(root, ".kami-tool-erase").click();
      find<HTMLButtonElement>(root, ".kami-tool-erase").click();

      expect(handlers.onToolChanged.mock.calls).toEqual([["erase"]]);
      expect(pressedTools()).toEqual([expect.stringContaining("kami-tool-erase")]);
    });

    it("switches tools with D, T, E and H", () => {
      const { handlers, pressedTools } = setup();

      for (const letter of ["t", "E", "h", "d"]) press(window, { key: letter });
      press(window, { key: "e", metaKey: true });

      expect(handlers.onToolChanged.mock.calls).toEqual([["write"], ["erase"], ["pan"], ["draw"]]);
      expect(pressedTools()).toEqual([expect.stringContaining("kami-tool-draw")]);
    });

    it("reflects setTool without echoing it back", () => {
      const { handlers, hud, pressedTools } = setup();

      hud.setTool("write");

      expect(pressedTools()).toEqual([expect.stringContaining("kami-tool-write")]);
      expect(handlers.onToolChanged).not.toHaveBeenCalled();
    });

    it("pans while Space is held and restores the tool on release", () => {
      const { handlers, hud, pressedTools } = setup();
      hud.setTool("erase");

      window.dispatchEvent(key("keydown", { key: " " }));
      window.dispatchEvent(key("keydown", { key: " ", repeat: true }));
      hud.setTool("pan");
      expect(pressedTools()).toEqual([expect.stringContaining("kami-tool-pan")]);

      window.dispatchEvent(key("keyup", { key: " " }));

      expect(handlers.onToolChanged.mock.calls).toEqual([["pan"], ["erase"]]);
      expect(pressedTools()).toEqual([expect.stringContaining("kami-tool-erase")]);
    });

    it("lets go of a held Space when the window loses focus", () => {
      const { handlers } = setup();

      window.dispatchEvent(key("keydown", { key: " " }));
      window.dispatchEvent(new Event("blur"));

      expect(handlers.onToolChanged.mock.calls).toEqual([["pan"], ["draw"]]);
    });
  });

  describe("persistence feedback", () => {
    it("announces unsaved work and accepts one keyboard or pen retry without changing tools", () => {
      const { root, hud, handlers, pressedTools } = setup();
      const state = {
        loading: false,
        saving: false,
        unsaved: 1,
        errors: [{ operation: "save", reason: "network" }],
      } satisfies Parameters<DomHud["setPersistence"]>[0];
      hud.setPersistence(state);
      const status = find(root, ".kami-persistence [role='status']");
      const retry = find<HTMLButtonElement>(root, "[aria-label='Retry board persistence']");
      expect(status.getAttribute("aria-live")).toBe("polite");
      expect(status.textContent).toContain("keep this tab open");
      expect(retry.hidden).toBe(false);
      retry.click();
      tap(retry);
      expect(handlers.onRetryPersistence).toHaveBeenCalledTimes(2);
      expect(pressedTools()).toEqual([expect.stringContaining("kami-tool-draw")]);
      hud.setPersistence({ ...state, saving: true });
      expect(status.textContent).toBe("Saving…");
      expect(retry.disabled).toBe(true);
      tap(retry);
      expect(handlers.onRetryPersistence).toHaveBeenCalledTimes(2);
      hud.setPersistence({ loading: false, saving: false, unsaved: 0, errors: [] });
      expect(status.textContent).toBe("Saved");
      expect(retry.hidden).toBe(true);
    });

    it("distinguishes a load failure from an empty saved board and from loading", () => {
      const { root, hud } = setup();
      hud.setPersistence({
        loading: false,
        saving: false,
        unsaved: 0,
        errors: [{ operation: "load", reason: "invalid-response" }],
      });
      const status = find(root, ".kami-persistence [role='status']");
      expect(status.textContent).toBe("Saved board unavailable.");
      hud.setPersistence({ loading: true, saving: false, unsaved: 0, errors: [] });
      expect(status.textContent).toBe("Loading board…");
    });
  });

  describe("walking", () => {
    const intents = (handlers: ReturnType<typeof createHandlers>): readonly WalkIntent[] =>
      handlers.onWalkIntent.mock.calls.map(([intent]) => intent);

    it("walks her with the thumbstick while it is held, and lets go on lift", () => {
      const { root, handlers } = setup();
      const stick = find<HTMLElement>(root, ".kami-stick");

      stick.dispatchEvent(pointer("pointerdown", 3, { pointerType: "pen", clientX: 60 }));
      stick.dispatchEvent(
        pointer("pointermove", 3, { pointerType: "pen", clientX: 45, clientY: -45 }),
      );
      stick.dispatchEvent(pointer("pointermove", 9, { pointerType: "touch", clientX: -60 }));
      stick.dispatchEvent(
        pointer("pointerup", 3, { pointerType: "pen", clientX: 45, clientY: -45 }),
      );

      expect(intents(handlers)).toEqual([
        { x: 1, y: 0 },
        { x: 1, y: -1 },
        { x: 0, y: 0 },
      ]);
      expect(stick.classList.contains("is-held")).toBe(false);
    });

    it("drops the thumbstick when the window blurs mid-hold", () => {
      const { root, handlers } = setup();
      const stick = find<HTMLElement>(root, ".kami-stick");

      stick.dispatchEvent(pointer("pointerdown", 3, { pointerType: "touch", clientX: -60 }));
      window.dispatchEvent(new Event("blur"));

      expect(intents(handlers)).toEqual([
        { x: -1, y: 0 },
        { x: 0, y: 0 },
      ]);
    });

    it("walks with the arrow keys, cancelling opposites, and lets go on blur", () => {
      const { handlers } = setup();

      window.dispatchEvent(key("keydown", { code: "ArrowRight" }));
      window.dispatchEvent(key("keydown", { code: "ArrowRight" }));
      window.dispatchEvent(key("keydown", { code: "ArrowLeft" }));
      window.dispatchEvent(key("keyup", { code: "ArrowLeft" }));
      window.dispatchEvent(key("keyup", { code: "ArrowRight" }));
      window.dispatchEvent(key("keydown", { code: "ArrowDown" }));
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

    it("leaves the letter keys to the tools", () => {
      const { handlers } = setup();

      press(window, { key: "d", code: "KeyD" });

      expect(handlers.onWalkIntent).not.toHaveBeenCalled();
      expect(handlers.onToolChanged).not.toHaveBeenCalled();
    });
  });

  describe("text prompt", () => {
    it("opens a Scribble-friendly field at the tap and resolves with the trimmed text on Enter", async () => {
      const { hud, prompt } = setup();
      expect(prompt.hidden).toBe(true);

      const answer = hud.promptText({ x: 200, y: 150 });

      expect(prompt.hidden).toBe(false);
      expect(document.activeElement).toBe(prompt);
      expect(prompt.style.left).toBe("200px");
      expect(prompt.getAttribute("enterkeyhint")).toBe("done");
      for (const guard of ["autocapitalize", "autocomplete", "autocorrect"]) {
        expect(prompt.getAttribute(guard)).toBe("off");
      }
      expect(prompt.getAttribute("spellcheck")).toBe("false");

      prompt.value = "  g = the moon's gravity ";
      prompt.dispatchEvent(key("keydown", { key: "Enter" }));

      await expect(answer).resolves.toBe("g = the moon's gravity");
      expect(prompt.hidden).toBe(true);
      expect(document.activeElement).not.toBe(prompt);
    });

    it("keeps the field on screen", () => {
      const { hud, prompt } = setup();

      void hud.promptText({ x: -500, y: -500 });

      expect(prompt.style.left).toBe("12px");
      expect(prompt.style.top).toBe("12px");
    });

    it("resolves null for Enter on nothing, Escape, and blur while empty", async () => {
      const { hud, prompt } = setup();

      const blank = hud.promptText({ x: 0, y: 0 });
      prompt.value = "   ";
      prompt.dispatchEvent(key("keydown", { key: "Enter" }));
      await expect(blank).resolves.toBeNull();

      const escaped = hud.promptText({ x: 0, y: 0 });
      prompt.value = "a mushroom";
      prompt.dispatchEvent(key("keydown", { key: "Escape" }));
      await expect(escaped).resolves.toBeNull();

      const blurred = hud.promptText({ x: 0, y: 0 });
      prompt.blur();
      await expect(blurred).resolves.toBeNull();
    });

    it("commits the text when focus leaves", async () => {
      const { hud, prompt } = setup();

      const answer = hud.promptText({ x: 0, y: 0 });
      prompt.value = "a ladder";
      prompt.blur();

      await expect(answer).resolves.toBe("a ladder");
    });

    it("explains the text budget before committing and keeps excess text editable", async () => {
      const { hud, prompt, root } = setup();
      const answer = hud.promptText({ x: 0, y: 0 });
      const feedback = find<HTMLElement>(root, ".kami-prompt-limit");
      expect(prompt.maxLength).toBe(INPUT_LIMITS.text);
      expect(feedback.hidden).toBe(false);
      expect(feedback.textContent).toContain(String(INPUT_LIMITS.text));
      prompt.value = "x".repeat(INPUT_LIMITS.text + 1);
      prompt.dispatchEvent(key("keydown", { key: "Enter" }));
      expect(prompt.hidden).toBe(false);
      expect(prompt.getAttribute("aria-invalid")).toBe("true");
      expect(feedback.textContent).toBe(TEXT_LIMIT_MESSAGE);
      prompt.value = "x".repeat(INPUT_LIMITS.text);
      prompt.dispatchEvent(key("keydown", { key: "Enter" }));
      await expect(answer).resolves.toHaveLength(INPUT_LIMITS.text);
      expect(feedback.hidden).toBe(true);
    });

    it("abandons the first prompt when a second opens", async () => {
      const { hud, prompt } = setup();

      const first = hud.promptText({ x: 10, y: 10 });
      prompt.value = "half-written";
      const second = hud.promptText({ x: 300, y: 300 });

      await expect(first).resolves.toBeNull();
      expect(prompt.value).toBe("");
      expect(prompt.hidden).toBe(false);
      expect(document.activeElement).toBe(prompt);

      prompt.value = "slow motion";
      prompt.dispatchEvent(key("keydown", { key: "Enter" }));
      await expect(second).resolves.toBe("slow motion");
    });

    it("keeps typed keys from walking Alice or switching tools", () => {
      const { hud, handlers, prompt } = setup();
      void hud.promptText({ x: 0, y: 0 });

      press(prompt, { key: "e", code: "KeyE" });
      press(prompt, { key: " ", code: "Space" });
      press(prompt, { key: "ArrowRight", code: "ArrowRight" });

      expect(handlers.onToolChanged).not.toHaveBeenCalled();
      expect(handlers.onWalkIntent).not.toHaveBeenCalled();
    });
  });

  describe("zoom", () => {
    it("zooms out, in, and recentres on Alice", () => {
      const { root, handlers } = setup();

      find<HTMLButtonElement>(root, ".kami-zoom-out").click();
      find<HTMLButtonElement>(root, ".kami-zoom-in").click();
      find<HTMLButtonElement>(root, ".kami-recenter").click();

      expect(handlers.onZoom.mock.calls).toEqual([[1 / ZOOM_STEP], [ZOOM_STEP]]);
      expect(handlers.onRecenter).toHaveBeenCalledOnce();
    });

    it("asks to switch Alice's self-walking to the opposite of what it shows", () => {
      const { root, hud, handlers } = setup();
      const toggle = find<HTMLButtonElement>(root, ".kami-autopilot");

      hud.setAutopilot(true);
      expect(toggle.getAttribute("aria-pressed")).toBe("true");
      toggle.click();
      expect(handlers.onAutopilotToggled).toHaveBeenLastCalledWith(false);

      hud.setAutopilot(false);
      expect(toggle.getAttribute("aria-pressed")).toBe("false");
      toggle.click();
      expect(handlers.onAutopilotToggled).toHaveBeenLastCalledWith(true);
    });
  });

  describe("Hold to talk", () => {
    it("talks while the CAT button is held, and stops when it is let go", () => {
      const { root, hud, handlers } = setup();
      const button = find<HTMLButtonElement>(root, ".kami-talk");

      button.dispatchEvent(pointer("pointerdown", 3, { pointerType: "touch", isPrimary: true }));
      expect(handlers.onTalkStarted).toHaveBeenCalledOnce();
      expect(handlers.onTalkEnded).not.toHaveBeenCalled();

      hud.setListening(true);
      expect(button.getAttribute("aria-pressed")).toBe("true");

      button.dispatchEvent(pointer("pointerup", 3, { pointerType: "touch", isPrimary: true }));
      expect(handlers.onTalkEnded).toHaveBeenCalledOnce();
      hud.setListening(false);
      expect(button.getAttribute("aria-pressed")).toBe("false");
    });

    it("talks while Space is held, once, and never inside a text field", () => {
      const { handlers } = setup();
      window.dispatchEvent(key("keydown", { code: "Space" }));
      window.dispatchEvent(key("keydown", { code: "Space" }));
      expect(handlers.onTalkStarted).toHaveBeenCalledOnce();
      window.dispatchEvent(key("keyup", { code: "Space" }));
      expect(handlers.onTalkEnded).toHaveBeenCalledOnce();

      const field = document.createElement("input");
      document.body.append(field);
      field.dispatchEvent(key("keydown", { code: "Space" }));
      expect(handlers.onTalkStarted).toHaveBeenCalledOnce();
      field.remove();
    });

    it("stops listening when the page loses focus mid-press", () => {
      const { handlers } = setup();
      window.dispatchEvent(key("keydown", { code: "Space" }));
      window.dispatchEvent(new FocusEvent("blur"));
      expect(handlers.onTalkEnded).toHaveBeenCalledOnce();
    });

    it("turns waiting for the wake word on and off from the ear", () => {
      const { root, handlers, hud } = setup();
      const ear = find<HTMLButtonElement>(root, ".kami-wake");

      tap(ear);
      expect(handlers.onWakeToggled.mock.calls).toEqual([[true]]);
      hud.setWaking(true);
      expect(ear.getAttribute("aria-pressed")).toBe("true");

      tap(ear);
      expect(handlers.onWakeToggled.mock.calls).toEqual([[true], [false]]);
      hud.setWaking(false);
      expect(ear.getAttribute("aria-pressed")).toBe("false");
    });
  });

  describe("Pencil taps", () => {
    it("activates a control once per pen, finger or mouse tap, swallowing the echoed click", () => {
      const { root, handlers } = setup();

      tap(find(root, ".kami-zoom-in"), "pen");
      tap(find(root, ".kami-zoom-in"), "touch");
      tap(find(root, ".kami-zoom-in"), "mouse");
      tap(find(root, ".kami-tool-erase"));

      expect(handlers.onZoom.mock.calls).toEqual([[ZOOM_STEP], [ZOOM_STEP], [ZOOM_STEP]]);
      expect(handlers.onToolChanged.mock.calls).toEqual([["erase"]]);
    });

    it("does nothing when the pen lifts elsewhere or the press is cancelled", () => {
      const { root, handlers } = setup();
      const recenter = find<HTMLButtonElement>(root, ".kami-recenter");

      recenter.dispatchEvent(pointer("pointerdown", 1, { pointerType: "pen" }));
      recenter.dispatchEvent(pointer("pointercancel", 1, { pointerType: "pen" }));
      recenter.dispatchEvent(pointer("pointerdown", 2, { pointerType: "pen" }));
      recenter.dispatchEvent(pointer("pointerup", 2, { pointerType: "pen", clientX: 500 }));

      expect(handlers.onRecenter).not.toHaveBeenCalled();
    });

    it("still activates from the keyboard after a tap", () => {
      const { root, handlers } = setup();
      const recenter = find<HTMLButtonElement>(root, ".kami-recenter");

      tap(recenter);
      recenter.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));

      expect(handlers.onRecenter).toHaveBeenCalledTimes(2);
    });

    it("drives the board menu: open, pick a board, confirm a clear", () => {
      const { root, handlers, hud } = setup();
      hud.setBoards(BOARDS, "moon-golf");
      const popover = find<HTMLElement>(root, ".kami-board-popover");

      tap(find(root, ".kami-board-toggle"));
      expect(popover.hidden).toBe(false);
      tap(find(root, "[data-board-id='wonderland']"));
      expect(handlers.onOpenBoard).toHaveBeenCalledExactlyOnceWith("wonderland");
      expect(popover.hidden).toBe(true);

      tap(find(root, ".kami-board-toggle"));
      tap(find(root, ".kami-board-clear"));
      expect(handlers.onClearBoard).not.toHaveBeenCalled();
      tap(find(root, ".kami-board-clear"));
      expect(handlers.onClearBoard).toHaveBeenCalledOnce();
    });
  });

  describe("board menu", () => {
    const open = (root: Element): HTMLElement => {
      find<HTMLButtonElement>(root, ".kami-board-toggle").click();
      return find<HTMLElement>(root, ".kami-board-popover");
    };

    it("shows the wordmark and the current board, and lists the boards when opened", () => {
      const { root, hud } = setup();
      hud.setBoards(BOARDS, "moon-golf");
      const popover = find<HTMLElement>(root, ".kami-board-popover");

      const wordmark = find<HTMLImageElement>(root, ".kami-wordmark");
      expect(wordmark.alt).toBe("kami");
      expect(wordmark.getAttribute("src")).toMatch(/kami-wordmark.*\.svg$/);
      expect(find(root, ".kami-board-title").textContent).toBe("Moon golf");
      expect(popover.hidden).toBe(true);

      open(root);
      const items = [...root.querySelectorAll(".kami-board-item")];

      expect(popover.hidden).toBe(false);
      expect(items.map((item) => item.textContent)).toEqual(["Wonderland", "Moon golf"]);
      expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    });

    it("opens another board and closes, but not the board already open", () => {
      const { root, handlers, hud } = setup();
      hud.setBoards(BOARDS, "moon-golf");

      const popover = open(root);
      find<HTMLButtonElement>(root, "[data-board-id='moon-golf']").click();
      expect(handlers.onOpenBoard).not.toHaveBeenCalled();
      expect(popover.hidden).toBe(true);

      open(root);
      find<HTMLButtonElement>(root, "[data-board-id='wonderland']").click();
      expect(handlers.onOpenBoard).toHaveBeenCalledExactlyOnceWith("wonderland");
      expect(popover.hidden).toBe(true);
    });

    it("starts a new board", () => {
      const { root, handlers } = setup();

      open(root);
      find<HTMLButtonElement>(root, ".kami-board-new").click();

      expect(handlers.onNewBoard).toHaveBeenCalledOnce();
    });

    it("clears the board only on a second tap", () => {
      const { root, handlers } = setup();
      const clear = find<HTMLButtonElement>(root, ".kami-board-clear");

      const popover = open(root);
      clear.click();
      expect(handlers.onClearBoard).not.toHaveBeenCalled();
      expect(clear.textContent).toBe("tap again to clear");
      expect(popover.hidden).toBe(false);

      clear.click();
      expect(handlers.onClearBoard).toHaveBeenCalledOnce();
      expect(popover.hidden).toBe(true);
      expect(clear.textContent).toBe("clear board");
    });

    it("forgets a half-confirmed clear when the board is pressed instead", () => {
      const { root, handlers } = setup();
      const clear = find<HTMLButtonElement>(root, ".kami-board-clear");

      const popover = open(root);
      clear.click();
      document.body.dispatchEvent(pointer("pointerdown", 1));
      expect(popover.hidden).toBe(true);

      open(root);
      clear.click();
      expect(handlers.onClearBoard).not.toHaveBeenCalled();
    });
  });

  describe("shared pages", () => {
    const SHARE = { boardId: "together", link: "http://kami.test/?board=together", company: 2 };

    it("swaps the board menu for the share affordance while the page is shared", () => {
      const { root, hud } = setup();
      const share = find<HTMLElement>(root, ".kami-share");
      const boards = find<HTMLElement>(root, ".kami-board-menu");
      expect(share.hidden).toBe(true);
      expect(boards.hidden).toBe(false);
      hud.setShare(SHARE);
      expect(share.hidden).toBe(false);
      expect(boards.hidden).toBe(true);
      expect(find(share, ".kami-share-page").textContent).toBe("together");
      hud.setShare(null);
      expect(share.hidden).toBe(true);
      expect(boards.hidden).toBe(false);
    });

    it("shows the mode's card over the page", () => {
      const { root, hud } = setup();
      const card = find<HTMLElement>(root, ".kami-title-card");
      expect(card.hidden).toBe(true);
      hud.showTitleCard({ title: "Sandbox", tagline: "Draw together.", opening: "Go on." });
      expect(card.hidden).toBe(false);
      expect(card.textContent).toContain("Sandbox");
      expect(card.textContent).toContain("Draw together.");
      expect(card.textContent).not.toContain("Go on.");
    });
  });
});
