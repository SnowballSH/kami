import type { ModeCard } from "../modes/types";
import { el } from "./dom";
import { FadingCard } from "./fadingCard";

export const TITLE_CARD_SHOWN_MS = 4500;
const ROLES_READ_MS = 2_000;

/** How long a mode's card stays: longer when it lists the players' roles. */
export const titleCardShownMs = (card: ModeCard, shownMs = TITLE_CARD_SHOWN_MS): number =>
  shownMs + ((card.roles?.length ?? 0) > 0 ? ROLES_READ_MS : 0);

/**
 * The mode's name and its one line, over the page for a moment when it opens, then gone: a tap
 * or a few seconds dismisses it. Nothing to choose; the page underneath is already live.
 */
export class TitleCard {
  private readonly title = el("h1", {
    className: "kami-title-card-title",
    attrs: { id: "kami-title-card-title" },
  });
  private readonly tagline = el("p", {
    className: "kami-title-card-tagline",
    attrs: { id: "kami-title-card-tagline", "aria-live": "polite" },
  });
  private readonly roles = el("ul", { className: "kami-title-card-roles" });
  private readonly card = new FadingCard(
    el(
      "div",
      {
        className: "kami-title-card",
        attrs: {
          role: "dialog",
          "aria-modal": "false",
          tabindex: "0",
          "aria-labelledby": this.title.id,
          "aria-describedby": this.tagline.id,
        },
      },
      [this.title, this.tagline, this.roles],
    ),
  );

  constructor(private readonly shownMs: number = TITLE_CARD_SHOWN_MS) {}

  get element(): HTMLElement {
    return this.card.element;
  }

  get showing(): boolean {
    return this.card.showing;
  }

  show(card: ModeCard): void {
    const roles = card.roles ?? [];
    this.title.textContent = card.title;
    this.tagline.textContent = card.tagline;
    this.roles.replaceChildren(...roles.map((role) => el("li", { text: role })));
    this.roles.hidden = roles.length === 0;
    this.card.show(titleCardShownMs(card, this.shownMs));
  }
}
