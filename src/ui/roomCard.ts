import type { RoomCard } from "../modes/types";
import { el } from "./dom";

const CARD_LIFETIME_MS = 5_000;
const FADE_MS = 900;
const FADING_CLASS = "is-fading";

/**
 * The title card a staged room opens on — mode, room, Kami's one line — which fades on its own,
 * and the small mark of where the room sits in its run, which stays until the next card.
 */
export class RoomCardView {
  private readonly heading = el("span", { className: "kami-room-card-heading" });
  private readonly title = el("h2", { className: "kami-room-card-title" });
  private readonly line = el("p", { className: "kami-room-card-line" });
  readonly card = el(
    "section",
    { className: "kami-room-card", attrs: { role: "status", "aria-live": "polite", hidden: "" } },
    [this.heading, this.title, this.line],
  );
  readonly mark = el("div", {
    className: "kami-room-mark",
    attrs: { role: "status", "aria-live": "polite", hidden: "" },
  });
  private fading: ReturnType<typeof setTimeout> | null = null;
  private hiding: ReturnType<typeof setTimeout> | null = null;

  show(card: RoomCard | null): void {
    this.cancel();
    if (card === null) {
      this.card.hidden = true;
      this.mark.hidden = true;
      return;
    }
    this.heading.textContent = card.mark === null ? card.mode : `${card.mode} · ${card.mark}`;
    this.title.textContent = card.title;
    this.line.textContent = card.line;
    this.mark.textContent = card.mark ?? "";
    this.mark.hidden = card.mark === null;
    this.card.hidden = false;
    this.fading = setTimeout(() => {
      this.card.classList.add(FADING_CLASS);
      this.hiding = setTimeout(() => {
        this.card.hidden = true;
      }, FADE_MS);
    }, CARD_LIFETIME_MS);
  }

  private cancel(): void {
    if (this.fading !== null) clearTimeout(this.fading);
    if (this.hiding !== null) clearTimeout(this.hiding);
    this.fading = null;
    this.hiding = null;
    this.card.classList.remove(FADING_CLASS);
  }
}
