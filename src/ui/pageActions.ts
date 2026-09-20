import { el } from "./dom";
import { icon } from "./icons";
import { activateOnTap } from "./tap";
import type { Detach, HudHandlers } from "./types";

const HOME_LABEL = "Back to the start";
const CLEAR_LABEL = "Clear this page";
const CLEAR_CONFIRM_LABEL = "Tap again to clear";
const CLEAR_CONFIRM_TEXT = "clear?";
const CONFIRMING_CLASS = "is-confirming";
const CONFIRM_FOR_MS = 3000;
const CLOSE_KEY = "Escape";

/** The address of the start screen: this page with nothing said about mode, board or stage. */
export const homeUrl = (location: Pick<Location, "origin" | "pathname">): string =>
  `${location.origin}${location.pathname}`;

/**
 * Two things every mode offers, whichever menu it shows beside them: leaving for the start
 * screen, and wiping the page. Clearing takes a second tap within a moment, because it cannot be
 * undone and the button sits where a thumb rests.
 */
export class PageActions {
  readonly element: HTMLElement;
  private readonly clear: HTMLButtonElement;
  private readonly confirmText = el("span", {
    className: "kami-page-confirm",
    text: CLEAR_CONFIRM_TEXT,
  });
  private disarming: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly handlers: Pick<HudHandlers, "onClearBoard">,
    goHome: () => void,
  ) {
    const home = el(
      "button",
      {
        className: "kami-control kami-page-home",
        attrs: { type: "button", "aria-label": HOME_LABEL, title: HOME_LABEL },
      },
      [icon("home")],
    );
    activateOnTap(home, goHome);
    this.clear = el(
      "button",
      {
        className: "kami-control kami-page-clear",
        attrs: { type: "button", "aria-label": CLEAR_LABEL, title: CLEAR_LABEL },
      },
      [icon("clear"), this.confirmText],
    );
    activateOnTap(this.clear, () => this.requestClear());
    this.element = el("div", { className: "kami-island kami-page-actions" }, [home, this.clear]);
    this.arm(false);
  }

  attach(owner: Document): Detach {
    const listeners = new AbortController();
    const options = { signal: listeners.signal, capture: true };
    owner.addEventListener(
      "pointerdown",
      (event) => {
        if (!(event.target instanceof Node && this.clear.contains(event.target))) this.arm(false);
      },
      options,
    );
    owner.addEventListener(
      "keydown",
      (event) => {
        if (event.key === CLOSE_KEY) this.arm(false);
      },
      options,
    );
    return () => {
      listeners.abort();
      this.arm(false);
    };
  }

  private get armed(): boolean {
    return this.clear.classList.contains(CONFIRMING_CLASS);
  }

  private requestClear(): void {
    if (!this.armed) {
      this.arm(true);
      return;
    }
    this.arm(false);
    this.handlers.onClearBoard();
  }

  private arm(armed: boolean): void {
    if (this.disarming !== null) clearTimeout(this.disarming);
    this.disarming = armed ? setTimeout(() => this.arm(false), CONFIRM_FOR_MS) : null;
    this.clear.classList.toggle(CONFIRMING_CLASS, armed);
    this.clear.setAttribute("aria-label", armed ? CLEAR_CONFIRM_LABEL : CLEAR_LABEL);
    this.confirmText.hidden = !armed;
  }
}
