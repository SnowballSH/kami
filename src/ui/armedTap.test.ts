import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArmedTap, DISARM_AFTER_MS } from "./armedTap";

describe("ArmedTap", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const act = vi.fn();
    const armedChanges: boolean[] = [];
    const armed = new ArmedTap(act, (state) => armedChanges.push(state));
    return { act, armed, armedChanges };
  };

  it("acts on the second tap only, and is disarmed after", () => {
    const { act, armed, armedChanges } = setup();

    armed.tap();
    expect(act).not.toHaveBeenCalled();
    expect(armed.armed).toBe(true);

    armed.tap();
    expect(act).toHaveBeenCalledOnce();
    expect(armed.armed).toBe(false);
    expect(armedChanges).toEqual([true, false]);
  });

  it("disarms on its own, so a much later tap only arms again", () => {
    const { act, armed, armedChanges } = setup();

    armed.tap();
    vi.advanceTimersByTime(DISARM_AFTER_MS);
    armed.tap();

    expect(act).not.toHaveBeenCalled();
    expect(armedChanges).toEqual([true, false, true]);
  });

  it("can be disarmed early, and ignores a disarm while not armed", () => {
    const { act, armed, armedChanges } = setup();

    armed.disarm();
    armed.tap();
    armed.disarm();
    armed.tap();

    expect(act).not.toHaveBeenCalled();
    expect(armedChanges).toEqual([true, false, true]);
  });
});
