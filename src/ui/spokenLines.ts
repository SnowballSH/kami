import { el } from "./dom";

/** A line said again within this long is not read out again. */
export const REPEAT_QUIET_MS = 10_000;
export const KEPT_LINES = 3;

/**
 * A visually hidden live region echoing Kami's handwriting, which exists only on the canvas, to
 * screen readers. Each line is appended so it is read as it arrives; the oldest are let go.
 */
export class SpokenLines {
  readonly element = el("div", {
    className: "kami-visually-hidden",
    attrs: { role: "status", "aria-live": "polite", "aria-relevant": "additions" },
  });
  private readonly saidAtMs = new Map<string, number>();
  private readonly now: () => number;

  constructor(now = () => performance.now()) {
    this.now = now;
  }

  say(line: string): void {
    const text = line.trim();
    if (text === "") return;
    const nowMs = this.now();
    for (const [said, atMs] of this.saidAtMs) {
      if (nowMs - atMs >= REPEAT_QUIET_MS) this.saidAtMs.delete(said);
    }
    if (this.saidAtMs.has(text)) return;
    this.saidAtMs.set(text, nowMs);
    this.element.append(el("p", { text }));
    while (this.element.childElementCount > KEPT_LINES) this.element.firstElementChild?.remove();
  }
}
