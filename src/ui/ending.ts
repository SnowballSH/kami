import { el, isShown, setShown } from "./dom";
import type { EndingEntry } from "./types";

export const ENDING_ADVANCE_MS = 1800;

const FINALE_HEADING = "The End";
const FINALE_CAPTION = "Every line of it yours.";
const EMPTY_CAPTION = "Not a drop of ink spent. Curiouser and curiouser.";

export class EndingView {
  readonly element: HTMLElement;
  private readonly heading = el("h1", { className: "kami-ending-heading", text: FINALE_HEADING });
  private readonly frame = el("div", { className: "kami-ending-frame" });
  private readonly caption = el("p", { className: "kami-ending-caption" });
  private readonly counter = el("p", { className: "kami-ending-counter" });
  private readonly restart = el("button", {
    className: "kami-button kami-ending-restart",
    text: "Play again",
    attrs: { type: "button" },
  });
  private entries: readonly EndingEntry[] = [];
  private page = 0;
  private advanceTimer: ReturnType<typeof setTimeout> | undefined;
  private onRestart: () => void = () => undefined;

  constructor() {
    this.element = el("div", { className: "kami-ending kami-cover kami-fade" }, [
      this.heading,
      this.frame,
      this.caption,
      this.counter,
      this.restart,
    ]);
    setShown(this.element, false);
    this.element.addEventListener("click", () => this.advance());
    this.restart.addEventListener("click", () => {
      const restart = this.onRestart;
      this.hide();
      restart();
    });
  }

  show(entries: readonly EndingEntry[], onRestart: () => void): void {
    this.entries = entries;
    this.onRestart = onRestart;
    setShown(this.element, true);
    this.turnTo(0);
  }

  hide(): void {
    clearTimeout(this.advanceTimer);
    this.entries = [];
    this.onRestart = () => undefined;
    this.frame.replaceChildren();
    setShown(this.element, false);
  }

  private advance(): void {
    if (isShown(this.element) && this.page < this.entries.length) this.turnTo(this.page + 1);
  }

  private turnTo(page: number): void {
    clearTimeout(this.advanceTimer);
    this.page = page;
    const entry = this.entries[page];
    const isFinale = entry === undefined;
    this.heading.hidden = !isFinale;
    this.restart.hidden = !isFinale;
    this.frame.hidden = isFinale;
    this.counter.hidden = isFinale;
    if (entry === undefined) {
      this.caption.textContent = this.entries.length === 0 ? EMPTY_CAPTION : FINALE_CAPTION;
      return;
    }
    this.frame.replaceChildren(entry.thumbnail);
    this.caption.textContent = entry.name;
    this.counter.textContent = `${page + 1} of ${this.entries.length}`;
    this.advanceTimer = setTimeout(() => this.advance(), ENDING_ADVANCE_MS);
  }
}
