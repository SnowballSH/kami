import type { RoomCard } from "../modes/types";
import { el } from "./dom";
import { FadingCard } from "./fadingCard";

export const ROOM_CARD_SHOWN_MS = 5_000;

/**
 * The title card a staged room opens on — mode, room, Kami's one line — which fades on its own,
 * and the small mark of where the room sits in its run, which stays until the next card.
 */
export class RoomCardView {
  private readonly heading = el("span", { className: "kami-room-card-heading" });
  private readonly title = el("h2", {
    className: "kami-room-card-title",
    attrs: { id: "kami-room-card-title" },
  });
  private readonly line = el("p", {
    className: "kami-room-card-line",
    attrs: { id: "kami-room-card-line", "aria-live": "polite" },
  });
  private readonly fading = new FadingCard(
    el(
      "section",
      {
        className: "kami-room-card",
        attrs: {
          role: "dialog",
          "aria-modal": "false",
          tabindex: "0",
          "aria-labelledby": this.title.id,
          "aria-describedby": this.line.id,
        },
      },
      [this.heading, this.title, this.line],
    ),
  );
  readonly card = this.fading.element;
  readonly mark = el("div", {
    className: "kami-room-mark",
    attrs: { role: "status", "aria-live": "polite", hidden: "" },
  });

  show(card: RoomCard | null): void {
    if (card === null) {
      this.fading.hide();
      this.mark.hidden = true;
      return;
    }
    this.heading.textContent = card.mark === null ? card.mode : `${card.mode} · ${card.mark}`;
    this.title.textContent = card.title;
    this.line.textContent = card.line;
    this.mark.textContent = card.mark ?? "";
    this.mark.hidden = card.mark === null;
    this.fading.show(ROOM_CARD_SHOWN_MS);
  }
}
