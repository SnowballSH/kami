import { capturePointer, el } from "./dom";
import { icon } from "./icons";

const LABEL = "How firmly Kami tidies a drawing";
const OFF_CLASS = "is-off";
const PERCENT = 100;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * One line and a bead: drag (or tap) along it to say how firmly Kami tidies what gets named.
 * All the way left he leaves the ink alone. Driven by pointer events rather than a native range
 * input, so it works under the page-wide touch guards and never takes the arrow keys from Alice.
 */
export class TidySlider {
  readonly element: HTMLElement;
  private readonly track = el("div", { className: "kami-tidy-track" });
  private readonly filled = el("div", { className: "kami-tidy-filled" });
  private readonly bead = el("div", { className: "kami-tidy-bead" });
  private value = 0;
  private dragging: number | null = null;

  constructor(private readonly onChange: (value: number) => void) {
    this.track.append(this.filled, this.bead);
    this.element = el(
      "div",
      {
        className: "kami-island kami-tidy",
        attrs: { role: "slider", "aria-label": LABEL, title: LABEL, "aria-valuemin": "0" },
      },
      [icon("tidy"), this.track],
    );
    this.element.setAttribute("aria-valuemax", String(PERCENT));
    this.track.addEventListener("pointerdown", (event) => {
      capturePointer(this.track, event.pointerId);
      this.dragging = event.pointerId;
      this.dragTo(event.clientX);
    });
    this.track.addEventListener("pointermove", (event) => {
      if (this.dragging === event.pointerId) this.dragTo(event.clientX);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
      this.track.addEventListener(type, (event) => {
        if (this.dragging === event.pointerId) this.dragging = null;
      });
    }
    this.show(this.value);
  }

  setValue(value: number): void {
    this.show(clamp01(value));
  }

  private dragTo(clientX: number): void {
    const { left, width } = this.track.getBoundingClientRect();
    if (width <= 0) return;
    const value = clamp01((clientX - left) / width);
    if (value === this.value) return;
    this.show(value);
    this.onChange(value);
  }

  private show(value: number): void {
    this.value = value;
    const percent = `${Math.round(value * PERCENT)}%`;
    this.filled.style.width = percent;
    this.bead.style.left = percent;
    this.element.classList.toggle(OFF_CLASS, value === 0);
    this.element.setAttribute("aria-valuenow", String(Math.round(value * PERCENT)));
  }
}
