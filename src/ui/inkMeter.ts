import { clamp } from "../core/geometry";
import { el } from "./dom";

const LOW_INK_RATIO = 0.15;
const LOW_CLASS = "is-low";
const PERCENT = 100;

export interface InkLevel {
  readonly total: number;
  readonly remaining: number;
}

export const inkRatio = ({ total, remaining }: InkLevel): number =>
  total > 0 ? clamp(remaining / total, 0, 1) : 0;

export class InkMeter {
  readonly element: HTMLElement;
  private readonly fill = el("div", { className: "kami-ink-fill" });
  private shownWidth = "";

  constructor() {
    this.element = el(
      "div",
      {
        className: "kami-ink",
        attrs: { role: "meter", "aria-label": "Ink", "aria-valuemin": "0", "aria-valuemax": "100" },
      },
      [
        el("span", { className: "kami-ink-label", text: "ink" }),
        el("div", { className: "kami-ink-track" }, [this.fill]),
      ],
    );
    this.set({ total: 1, remaining: 1 });
  }

  set(level: InkLevel): void {
    const ratio = inkRatio(level);
    const width = `${(ratio * PERCENT).toFixed(1)}%`;
    if (width === this.shownWidth) return;
    this.shownWidth = width;
    this.fill.style.width = width;
    this.element.classList.toggle(LOW_CLASS, ratio < LOW_INK_RATIO);
    this.element.setAttribute("aria-valuenow", String(Math.round(ratio * PERCENT)));
  }
}
