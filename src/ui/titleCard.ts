import { el, setShown } from "./dom";
import type { TitleCard } from "./types";

export const TITLE_FADE_MS = 500;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class TitleCardView {
  readonly element: HTMLElement;
  private readonly title = el("h1", { className: "kami-title-heading" });
  private readonly subtitle = el("p", { className: "kami-title-subtitle" });

  constructor() {
    this.element = el("div", { className: "kami-title kami-cover kami-fade" }, [
      this.title,
      this.subtitle,
    ]);
    this.element.style.setProperty("--kami-fade-ms", `${TITLE_FADE_MS}ms`);
    setShown(this.element, false);
  }

  async show(card: TitleCard): Promise<void> {
    this.title.textContent = card.title;
    this.subtitle.textContent = card.subtitle ?? "";
    setShown(this.element, true);
    await wait(Math.max(card.durationMs - TITLE_FADE_MS, TITLE_FADE_MS));
    setShown(this.element, false);
    await wait(TITLE_FADE_MS);
  }
}
