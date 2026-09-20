import { describe, expect, it, vi } from "vitest";
import type { RuleId } from "../rules/types";
import { DomLawsPanel } from "./lawsPanel";
import type { LawListing } from "./types";

const LAWS: readonly LawListing[] = [
  { id: "rule-1" as RuleId, text: "gravity is weak", gloss: "gravity at 0.3" },
  { id: "rule-2" as RuleId, text: "it is night", gloss: "daylight at 0.1" },
];

const pointer = (type: string, init: PointerEventInit = {}): PointerEvent =>
  new PointerEvent(type, {
    pointerId: 7,
    pointerType: "pen",
    isPrimary: true,
    bubbles: true,
    ...init,
  });

const tap = (target: Element): void => {
  target.dispatchEvent(pointer("pointerdown"));
  target.dispatchEvent(pointer("pointerup"));
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
};

const items = (panel: DomLawsPanel): readonly HTMLButtonElement[] => [
  ...panel.element.querySelectorAll<HTMLButtonElement>(".kami-law"),
];

describe("DomLawsPanel", () => {
  const setup = () => {
    const onRepealLaw = vi.fn<(id: RuleId) => void>();
    const panel = new DomLawsPanel({ onRepealLaw });
    document.body.append(panel.element);
    return { panel, onRepealLaw };
  };

  it("stays visible with an empty hint, then lists laws in order with their glosses", () => {
    const { panel } = setup();
    expect(panel.element.hidden).toBe(false);
    expect(panel.element.textContent).toContain("None yet — write one, like 'gravity is weaker'.");
    panel.setLaws(LAWS);
    expect(panel.element.hidden).toBe(false);
    expect(items(panel).map((item) => item.textContent)).toEqual([
      "gravity is weakgravity at 0.3",
      "it is nightdaylight at 0.1",
    ]);
    panel.setLaws([]);
    expect(panel.element.hidden).toBe(false);
    expect(panel.element.textContent).toContain("None yet — write one, like 'gravity is weaker'.");
  });

  it("repeals a law on the second tap, and a tap elsewhere disarms the first", () => {
    const { panel, onRepealLaw } = setup();
    panel.setLaws(LAWS);
    const [gravity] = items(panel);
    if (gravity === undefined) throw new Error("no law listed");
    tap(gravity);
    expect(onRepealLaw).not.toHaveBeenCalled();
    expect(items(panel)[0]?.classList.contains("is-confirming")).toBe(true);
    expect(items(panel)[0]?.textContent).toContain("tap again to repeal");

    const night = items(panel)[1];
    if (night === undefined) throw new Error("no second law listed");
    tap(night);
    expect(onRepealLaw).not.toHaveBeenCalled();
    expect(items(panel).map((item) => item.classList.contains("is-confirming"))).toEqual([
      false,
      true,
    ]);

    const armed = items(panel)[1];
    if (armed === undefined) throw new Error("no armed law");
    tap(armed);
    expect(onRepealLaw).toHaveBeenCalledWith("rule-2");
    panel.setLaws(LAWS.slice(0, 1));
    expect(items(panel).map((item) => item.classList.contains("is-confirming"))).toEqual([false]);
  });

  it("disarms by itself after a few seconds, so a stray touch much later repeals nothing", () => {
    vi.useFakeTimers();
    try {
      const { panel, onRepealLaw } = setup();
      panel.setLaws(LAWS);
      const [gravity] = items(panel);
      if (gravity === undefined) throw new Error("no law listed");
      tap(gravity);
      expect(items(panel)[0]?.classList.contains("is-confirming")).toBe(true);

      vi.advanceTimersByTime(3000);
      expect(items(panel)[0]?.classList.contains("is-confirming")).toBe(false);
      const later = items(panel)[0];
      if (later === undefined) throw new Error("no law listed");
      tap(later);
      expect(onRepealLaw).not.toHaveBeenCalled();
      expect(items(panel)[0]?.classList.contains("is-confirming")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
