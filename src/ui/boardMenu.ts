import wordmarkUrl from "../brand/assets/kami-wordmark.svg";
import { ArmedTap } from "./armedTap";
import { el } from "./dom";
import { icon } from "./icons";
import { activateOnTap } from "./tap";
import type { BoardListing, Detach, HudHandlers } from "./types";

type BoardHandlers = Pick<HudHandlers, "onOpenBoard" | "onNewBoard" | "onClearBoard">;

const WORDMARK = "kami";
const NEW_LABEL = "new board";
const CLEAR_LABEL = "clear board";
const CLEAR_CONFIRM_LABEL = "tap again to clear";
const CONFIRMING_CLASS = "is-confirming";
const CLOSE_KEY = "Escape";

const menuItem = (className: string, text: string, onTap: () => void): HTMLButtonElement => {
  const item = el("button", {
    className: `kami-menu-item ${className}`,
    text,
    attrs: { type: "button", role: "menuitem" },
  });
  activateOnTap(item, onTap);
  return item;
};

export class BoardMenu {
  readonly element: HTMLElement;
  private readonly handlers: BoardHandlers;
  private readonly title = el("span", { className: "kami-board-title" });
  private readonly list = el("div", {
    className: "kami-board-list kami-scrollable",
    attrs: { role: "group", "aria-label": "Boards" },
  });
  private readonly toggle: HTMLButtonElement;
  private readonly popover: HTMLElement;
  private readonly clear: HTMLButtonElement;
  private readonly clearing: ArmedTap;
  private currentId = "";

  constructor(handlers: BoardHandlers) {
    this.handlers = handlers;
    this.toggle = el(
      "button",
      {
        className: "kami-control kami-board-toggle",
        attrs: {
          type: "button",
          "aria-haspopup": "menu",
          "aria-label": "Boards",
          title: "Boards",
        },
      },
      [
        el("img", { className: "kami-wordmark", attrs: { src: wordmarkUrl, alt: WORDMARK } }),
        this.title,
        icon("chevron"),
      ],
    );
    activateOnTap(this.toggle, () => this.setOpen(!this.open));
    this.clearing = new ArmedTap(
      () => this.choose(() => handlers.onClearBoard()),
      (armed) => this.showClearArmed(armed),
    );
    this.clear = menuItem("kami-board-clear", CLEAR_LABEL, () => this.clearing.tap());
    this.popover = el(
      "div",
      { className: "kami-island kami-board-popover", attrs: { role: "menu" } },
      [
        this.list,
        menuItem("kami-board-new", NEW_LABEL, () => this.choose(() => handlers.onNewBoard())),
        this.clear,
      ],
    );
    this.element = el("div", { className: "kami-board-menu" }, [this.toggle, this.popover]);
    this.setOpen(false);
  }

  get open(): boolean {
    return !this.popover.hidden;
  }

  attach(owner: Document): Detach {
    const listeners = new AbortController();
    const options = { signal: listeners.signal, capture: true };
    owner.addEventListener("pointerdown", (event) => this.closeIfOutside(event.target), options);
    owner.addEventListener(
      "keydown",
      (event) => {
        if (event.key === CLOSE_KEY) this.setOpen(false);
      },
      options,
    );
    return () => listeners.abort();
  }

  setBoards(boards: readonly BoardListing[], currentId: string): void {
    this.currentId = currentId;
    this.title.textContent = boards.find((board) => board.id === currentId)?.title ?? currentId;
    this.list.replaceChildren(...boards.map((board) => this.boardItem(board)));
  }

  private boardItem(board: BoardListing): HTMLButtonElement {
    const item = menuItem("kami-board-item", board.title, () =>
      this.choose(() => {
        if (board.id !== this.currentId) this.handlers.onOpenBoard(board.id);
      }),
    );
    item.setAttribute("role", "menuitemradio");
    item.setAttribute("aria-checked", String(board.id === this.currentId));
    item.dataset.boardId = board.id;
    return item;
  }

  private choose(act: () => void): void {
    this.setOpen(false);
    act();
  }

  private showClearArmed(armed: boolean): void {
    this.clear.classList.toggle(CONFIRMING_CLASS, armed);
    this.clear.textContent = armed ? CLEAR_CONFIRM_LABEL : CLEAR_LABEL;
  }

  private setOpen(open: boolean): void {
    this.popover.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
    this.clearing.disarm();
  }

  private closeIfOutside(target: EventTarget | null): void {
    if (!this.open) return;
    if (target instanceof Node && this.element.contains(target)) return;
    this.setOpen(false);
  }
}
