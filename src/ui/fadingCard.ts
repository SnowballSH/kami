import { motionAllowed } from "../render/animation/motion";
import { activateOnTap } from "./tap";

export const CARD_FADE_MS = 150;
const FADING_CLASS = "is-fading";

/** A card over the page that fades after a while on its own, or at once on a tap, Enter or Space. */
export class FadingCard {
  private fadeAt: ReturnType<typeof setTimeout> | null = null;
  private goneAt: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly element: HTMLElement) {
    element.hidden = true;
    activateOnTap(element, () => this.fade());
    element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      this.fade();
    });
  }

  get showing(): boolean {
    return !this.element.hidden;
  }

  show(forMs: number): void {
    this.reset();
    this.element.hidden = false;
    this.fadeAt = setTimeout(() => this.fade(), forMs);
  }

  hide(): void {
    this.reset();
    this.element.hidden = true;
  }

  private fade(): void {
    if (this.element.hidden || this.element.classList.contains(FADING_CLASS)) return;
    this.reset();
    this.element.classList.add(FADING_CLASS);
    this.goneAt = setTimeout(() => this.hide(), motionAllowed() ? CARD_FADE_MS : 0);
  }

  private reset(): void {
    if (this.fadeAt !== null) clearTimeout(this.fadeAt);
    if (this.goneAt !== null) clearTimeout(this.goneAt);
    this.fadeAt = null;
    this.goneAt = null;
    this.element.classList.remove(FADING_CLASS);
  }
}
