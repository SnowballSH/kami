import type { ModeCard } from "../modes/types";
import { el } from "./dom";
import { activateOnTap } from "./tap";

export const TITLE_CARD_SHOWN_MS = 4500;
export const titleCardShownMs = (card: ModeCard, shownMs = TITLE_CARD_SHOWN_MS): number =>
  shownMs + ((card.roles?.length ?? 0) > 0 ? 2_000 : 0);
const FADING_CLASS = "is-fading";
export const TITLE_CARD_FADE_MS = 150;

/**
 * The mode's name and its one line, over the page for a moment when it opens, then gone: a tap
 * or a few seconds dismisses it. Nothing to choose; the page underneath is already live.
 */
export class TitleCard {
  readonly element: HTMLElement;
  private readonly title = el("h1", { className: "kami-title-card-title" });
  private readonly tagline = el("p", { className: "kami-title-card-tagline" });
  private readonly roles = el("ul", { className: "kami-title-card-roles" });
  private hideAt: ReturnType<typeof setTimeout> | null = null;
  private goneAt: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly shownMs: number = TITLE_CARD_SHOWN_MS) {
    this.element = el(
      "div",
      {
        className: "kami-title-card",
        attrs: { role: "dialog", "aria-modal": "false", tabindex: "0" },
      },
      [this.title, this.tagline, this.roles],
    );
    this.title.id = "kami-title-card-title";
    this.tagline.id = "kami-title-card-tagline";
    this.element.setAttribute("aria-labelledby", this.title.id);
    this.element.setAttribute("aria-describedby", this.tagline.id);
    this.tagline.setAttribute("aria-live", "polite");
    this.element.hidden = true;
    activateOnTap(this.element, () => this.fade());
    this.element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      this.fade();
    });
  }

  get showing(): boolean {
    return !this.element.hidden;
  }

  show(card: ModeCard): void {
    this.clearTimers();
    this.title.textContent = card.title;
    this.tagline.textContent = card.tagline;
    this.roles.replaceChildren(...(card.roles ?? []).map((role) => el("li", { text: role })));
    this.roles.hidden = (card.roles?.length ?? 0) === 0;
    this.element.classList.remove(FADING_CLASS);
    this.element.hidden = false;
    this.hideAt = setTimeout(() => this.fade(), titleCardShownMs(card, this.shownMs));
  }

  private fade(): void {
    if (this.element.hidden || this.element.classList.contains(FADING_CLASS)) return;
    this.clearTimers();
    this.element.classList.add(FADING_CLASS);
    this.goneAt = setTimeout(() => {
      this.element.hidden = true;
      this.element.classList.remove(FADING_CLASS);
      this.goneAt = null;
    }, TITLE_CARD_FADE_MS);
  }

  private clearTimers(): void {
    if (this.hideAt !== null) clearTimeout(this.hideAt);
    if (this.goneAt !== null) clearTimeout(this.goneAt);
    this.hideAt = null;
    this.goneAt = null;
  }
}
