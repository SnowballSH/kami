import { describe, expect, it, vi } from "vitest";
import { TidySlider } from "./tidySlider";

const mounted = (onChange = vi.fn<(value: number) => void>()) => {
  const slider = new TidySlider(onChange);
  document.body.append(slider.element);
  const track = slider.element.querySelector<HTMLElement>(".kami-tidy-track");
  if (track === null) throw new Error("the slider has no track");
  track.getBoundingClientRect = () => new DOMRect(100, 0, 200, 44);
  track.setPointerCapture = () => undefined;
  return { slider, track, onChange };
};

const pointer = (type: string, clientX: number): PointerEvent =>
  new PointerEvent(type, { clientX, pointerId: 1, bubbles: true });

describe("TidySlider", () => {
  it("reflects a value without reporting it", () => {
    const { slider, onChange } = mounted();
    slider.setValue(0.5);
    expect(slider.element.getAttribute("aria-valuenow")).toBe("50");
    expect(slider.element.classList.contains("is-off")).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports where the bead is dragged to, from nothing to as firm as it gets", () => {
    const { track, slider, onChange } = mounted();
    track.dispatchEvent(pointer("pointerdown", 250));
    expect(onChange).toHaveBeenLastCalledWith(0.75);
    track.dispatchEvent(pointer("pointermove", 900));
    expect(onChange).toHaveBeenLastCalledWith(1);
    track.dispatchEvent(pointer("pointermove", -50));
    expect(onChange).toHaveBeenLastCalledWith(0);
    expect(slider.element.classList.contains("is-off")).toBe(true);
  });

  it("stops following the pointer once it lifts", () => {
    const { track, onChange } = mounted();
    track.dispatchEvent(pointer("pointerdown", 150));
    track.dispatchEvent(pointer("pointerup", 150));
    track.dispatchEvent(pointer("pointermove", 300));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(0.25);
  });

  it("says nothing while the bead stays where it is", () => {
    const { track, onChange } = mounted();
    track.dispatchEvent(pointer("pointerdown", 200));
    track.dispatchEvent(pointer("pointermove", 200));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
