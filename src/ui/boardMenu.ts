import wordmarkUrl from "../brand/assets/kami-wordmark.svg";
import { ArmedTap } from "./armedTap";
import { el } from "./dom";
import { icon } from "./icons";
import { Popover } from "./popover";
import { activateOnTap } from "./tap";
import type { BoardListing, Detach, HudHandlers } from "./types";

type BoardHandlers = Pick<HudHandlers, "onOpenBoard" | "onNewBoard" | "onClearBoard">;

const WORDMARK = "kami";
const CLEAR_LABEL = "clear board";
const CLEAR_CONFIRM_LABEL = "tap again to clear";
const CONFIRMING_CLASS = "is-confirming";

const menuItem = (className: string, text: string, onTap: () => void): HTMLButtonElement => {
  const item = el("button", {
    className: `kami-menu-item ${className}`,
    text,
    attrs: { type: "button", role: "menuitem" },
  });
  activateOnTap(item, onTap);
  return item;
};

/** The board's title, opening a menu of the boards this device knows, a new one, and clearing this one. */
export class BoardMenu {
  readonly element: HTMLElement;
  private readonly title = el("span", { className: "kami-board-title" });
  private readonly list = el("div", {
    className: "kami-board-list kami-scrollable",
    attrs: { role: "group", "aria-label": "Boards" },
  });
  private readonly clear: HTMLButtonElement;
  private readonly clearing: ArmedTap;
  private readonly popover: Popover;
  private currentId = "";

  constructor(private readonly handlers: BoardHandlers) {
    const toggle = el(
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
    this.clearing = new ArmedTap(
      () => this.choose(() => handlers.onClearBoard()),
      (armed) => {
        this.clear.classList.toggle(CONFIRMING_CLASS, armed);
        this.clear.textContent = armed ? CLEAR_CONFIRM_LABEL : CLEAR_LABEL;
      },
    );
    this.clear = menuItem("kami-board-clear", CLEAR_LABEL, () => this.clearing.tap());
    const panel = el(
      "div",
      { className: "kami-island kami-board-popover", attrs: { role: "menu" } },
      [
        this.list,
        menuItem("kami-board-new", "new board", () => this.choose(() => handlers.onNewBoard())),
        this.clear,
      ],
    );
    this.element = el("div", { className: "kami-board-menu" }, [toggle, panel]);
    this.popover = new Popover(this.element, toggle, panel, () => this.clearing.disarm());
  }

  get open(): boolean {
    return this.popover.open;
  }

  attach(owner: Document): Detach {
    return this.popover.attach(owner);
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
    this.popover.setOpen(false);
    act();
  }
}
