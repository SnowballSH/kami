import { describe, expect, it } from "vitest";
import { NATURES } from "../cat/types";
import { MARKER, mapNatures, mixRgb, NATURE_TINTS, noteCss, rgbCss } from "./palette";

describe("palette", () => {
  it("has a marker tint for every nature", () => {
    expect(Object.keys(NATURE_TINTS).sort()).toEqual([...NATURES].sort());
    for (const nature of NATURES) {
      const tint = NATURE_TINTS[nature];
      expect(tint).toHaveLength(3);
      expect(tint.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)).toBe(true);
    }
  });

  it("gives the roles the colours a whiteboard tray would", () => {
    expect(NATURE_TINTS.ink).toEqual(MARKER.black);
    expect(NATURE_TINTS.solid).toEqual(MARKER.black);
    expect(NATURE_TINTS.goal).toEqual(MARKER.green);
    expect(NATURE_TINTS.hazard).toEqual(MARKER.red);
    expect(NATURE_TINTS.spawn).toEqual(MARKER.blue);
  });

  it("keeps every spirit its own colour", () => {
    const spirits = NATURES.filter((nature) => !["ink", "solid"].includes(nature));
    expect(new Set(spirits.map((nature) => rgbCss(NATURE_TINTS[nature]))).size).toBe(
      spirits.length,
    );
  });

  it("writes Kami in blue, the player in black, and lets the tone win", () => {
    expect(noteCss("kami", "plain")).toBe(rgbCss(MARKER.blue));
    expect(noteCss("player", "plain")).toBe(rgbCss(MARKER.black));
    expect(noteCss("player", "understood")).toBe(rgbCss(MARKER.green));
    expect(noteCss("kami", "understood")).toBe(rgbCss(MARKER.green));
    expect(noteCss("player", "confused")).toBe(rgbCss(MARKER.red));
  });

  it("pales handwriting toward moonlight as the board darkens, so it stays readable at night", () => {
    const luminance = (css: string): number =>
      (css.match(/\d+/g) ?? []).slice(0, 3).reduce((sum, part) => sum + Number(part), 0);
    expect(noteCss("player", "plain", 1)).toBe(rgbCss(MARKER.black));
    expect(luminance(noteCss("player", "plain", 0.1))).toBeGreaterThan(3 * 170);
    expect(luminance(noteCss("kami", "plain", 0.5))).toBeGreaterThan(
      luminance(rgbCss(MARKER.blue)),
    );
    expect(luminance(noteCss("kami", "plain", 0.5))).toBeLessThan(
      luminance(noteCss("kami", "plain", 0)),
    );
  });

  it("mixes from one colour to another", () => {
    expect(mixRgb([0, 0, 0], [200, 100, 50], 0)).toEqual([0, 0, 0]);
    expect(mixRgb([0, 0, 0], [200, 100, 50], 0.5)).toEqual([100, 50, 25]);
    expect(mixRgb([0, 0, 0], [200, 100, 50], 1)).toEqual([200, 100, 50]);
  });

  it("writes canvas-ready colours", () => {
    expect(rgbCss([1, 2, 3])).toBe("rgba(1, 2, 3, 1)");
    expect(rgbCss([1, 2, 3], 0.5)).toBe("rgba(1, 2, 3, 0.5)");
  });

  it("maps a value onto every nature", () => {
    const names = mapNatures((nature) => nature.toUpperCase());
    expect(names.bouncy).toBe("BOUNCY");
    expect(Object.keys(names)).toHaveLength(NATURES.length);
  });
});
