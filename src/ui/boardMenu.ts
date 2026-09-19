import { el } from "./dom";
import { icon } from "./icons";
import type { BoardListing, Detach, HudHandlers } from "./types";

type BoardHandlers = Pick<HudHandlers, "onOpenBoard" | "onNewBoard" | "onClearBoard">;

const WORDMARK = "kami";
const NEW_LABEL = "new board";
const CLEAR_LABEL = "clear board";
const CLEAR_CONFIRM_LABEL = "tap again to clear";
const CONFIRMING_CLASS = "is-confirming";
const CLOSE_KEY = "Escape";

const menuItem = (className: string, text: string, onClick: () => void): HTMLButtonElement => {
  const item = el("button", {
    className: `kami-menu-item ${className}`,
    text,
    attrs: { type: "button", role: "menuitem" },
  });
  item.addEventListener("click", onClick);
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
  private currentId = "";

  constructor(handlers: BoardHandlers) {
    this.handlers = handlers;
    this.toggle = el(
      "button",
      {
        className: "kami-control kami-board-toggle",
        attrs: { type: "button", "aria-haspopup": "menu", "aria-label": "Boards" },
      },
      [el("span", { className: "kami-wordmark", text: WORDMARK }), this.title, icon("chevron")],
    );
    this.toggle.addEventListener("click", () => this.setOpen(!this.open));
    this.clear = menuItem("kami-board-clear", CLEAR_LABEL, () => this.requestClear());
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

  private requestClear(): void {
    if (this.confirmingClear) {
      this.choose(() => this.handlers.onClearBoard());
      return;
    }
    this.setConfirmingClear(true);
  }

  private get confirmingClear(): boolean {
    return this.clear.classList.contains(CONFIRMING_CLASS);
  }

  private setConfirmingClear(confirming: boolean): void {
    this.clear.classList.toggle(CONFIRMING_CLASS, confirming);
    this.clear.textContent = confirming ? CLEAR_CONFIRM_LABEL : CLEAR_LABEL;
  }

  private setOpen(open: boolean): void {
    this.popover.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
    this.setConfirmingClear(false);
  }

  private closeIfOutside(target: EventTarget | null): void {
    if (!this.open) return;
    if (target instanceof Node && this.element.contains(target)) return;
    this.setOpen(false);
  }
}
