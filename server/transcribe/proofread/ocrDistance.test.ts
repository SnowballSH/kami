// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MisreadWord, ocrDistance } from "./ocrDistance";

describe("ocrDistance", () => {
  it("is nothing for the same word, whatever the case", () => {
    expect(ocrDistance("Alice", "alice")).toBe(0);
  });

  it("charges less for the mistakes handwriting readers make", () => {
    expect(ocrDistance("sunikui", "sumikui")).toBeCloseTo(0.4);
    expect(ocrDistance("rnoon", "moon")).toBeCloseTo(0.3);
    expect(ocrDistance("dice", "alice")).toBeCloseTo(0.5);
    expect(ocrDistance("gravlty", "gravity")).toBeCloseTo(0.4);
    expect(ocrDistance("gravxty", "gravity")).toBe(1);
  });

  it("charges less for characters the reader was unsure of", () => {
    const sure = ocrDistance("mass", "mars", [1, 1, 1, 1]);
    const unsure = ocrDistance("mass", "mars", [1, 1, 0.2, 1]);
    expect(unsure).toBeLessThan(sure);
    expect(unsure).toBeGreaterThan(0);
  });

  it("gives up past its ceiling", () => {
    expect(ocrDistance("gravity", "uniform", [], 1)).toBe(Number.POSITIVE_INFINITY);
    expect(new MisreadWord("rnoon").distanceTo("moon", 1)).toBeCloseTo(0.3);
  });

  it("measures one reading against many words", () => {
    const read = new MisreadWord("bouncv", [1, 1, 1, 1, 1, 0.3]);
    expect(read.distanceTo("bouncy")).toBeLessThan(read.distanceTo("bounce"));
    expect(read.distanceTo("bouncy")).toBeCloseTo(read.distanceTo("bouncy"));
  });
});
