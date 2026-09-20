import { afterEach, describe, expect, it, vi } from "vitest";
import { motionAllowed } from "./motion";

describe("motionAllowed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows the reduced-motion media preference", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(motionAllowed()).toBe(true);

    vi.stubGlobal("window", {
      matchMedia: vi.fn(() => ({ matches: true })),
    });
    expect(motionAllowed()).toBe(false);
  });
});
