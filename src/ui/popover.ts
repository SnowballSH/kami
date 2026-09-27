import { activateOnTap } from "./tap";
import type { Detach } from "./types";

const CLOSE_KEY = "Escape";

/** A toggle and the panel it opens inside `container`; a press outside the container or Escape closes it. */
export class Popover {
  constructor(
    private readonly container: HTMLElement,
    private readonly toggle: HTMLButtonElement,
    private readonly panel: HTMLElement,
    private readonly onOpenChange: (open: boolean) => void = () => {},
  ) {
    activateOnTap(toggle, () => this.setOpen(!this.open));
    this.setOpen(false);
  }

  get open(): boolean {
    return !this.panel.hidden;
  }

  setOpen(open: boolean): void {
    this.panel.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
    this.onOpenChange(open);
  }

  attach(owner: Document): Detach {
    const listeners = new AbortController();
    const options = { signal: listeners.signal, capture: true };
    owner.addEventListener(
      "pointerdown",
      ({ target }) => {
        if (this.open && !(target instanceof Node && this.container.contains(target)))
          this.setOpen(false);
      },
      options,
    );
    owner.addEventListener(
      "keydown",
      (event) => {
        if (event.key === CLOSE_KEY) this.setOpen(false);
      },
      options,
    );
    return () => listeners.abort();
  }
}
