import { el, setShown } from "./dom";

const LINGER_MS = 1800;
const FADE_MS = 1400;

/** Words written to the world, shown big across the page and then let go of. */
export class Scrawl {
  readonly element = el("p", {
    className: "kami-scrawl kami-fade",
    attrs: { "aria-live": "polite" },
  });
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.element.style.setProperty("--kami-fade-ms", `${FADE_MS}ms`);
    setShown(this.element, false);
  }

  write(text: string): void {
    clearTimeout(this.hideTimer);
    this.element.textContent = text;
    setShown(this.element, true);
    this.hideTimer = setTimeout(() => setShown(this.element, false), LINGER_MS);
  }
}
