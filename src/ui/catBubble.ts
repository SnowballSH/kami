import { el, setShown, svgEl } from "./dom";

const BASE_VISIBLE_MS = 3200;
const VISIBLE_MS_PER_CHARACTER = 55;

const GRIN_PATHS = [
  "M6 22c6 26 46 26 52 0",
  "M6 22c14 10 38 10 52 0",
  "M17 28.5v9M25 30.5v10.5M32 31v11.5M39 30.5v10.5M47 28.5v9",
] as const;

const EYE_PATHS = [
  "M14 10c3-5 8-5 11 0-3 4-8 4-11 0Z",
  "M39 10c3-5 8-5 11 0-3 4-8 4-11 0Z",
] as const;

export const captionDurationMs = (line: string): number =>
  BASE_VISIBLE_MS + line.length * VISIBLE_MS_PER_CHARACTER;

const catFace = (): SVGElement =>
  svgEl("svg", { viewBox: "0 0 64 48", class: "kami-cat-face", "aria-hidden": "true" }, [
    svgEl(
      "g",
      { class: "kami-cat-eyes" },
      EYE_PATHS.map((d) => svgEl("path", { d })),
    ),
    svgEl(
      "g",
      { class: "kami-cat-grin" },
      GRIN_PATHS.map((d) => svgEl("path", { d })),
    ),
  ]);

export class CatBubble {
  readonly element: HTMLElement;
  private readonly caption = el("p", { className: "kami-cat-caption" });
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.element = el(
      "div",
      { className: "kami-cat kami-fade", attrs: { role: "status", "aria-live": "polite" } },
      [catFace(), this.caption],
    );
    setShown(this.element, false);
  }

  say(line: string): void {
    clearTimeout(this.hideTimer);
    this.caption.textContent = line;
    setShown(this.element, true);
    this.hideTimer = setTimeout(() => setShown(this.element, false), captionDurationMs(line));
  }
}
