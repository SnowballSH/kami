import { describe, expect, it } from "vitest";
import { createRenderer } from "./index";

describe("createRenderer", () => {
  it("says so plainly when the canvas has no 2D context", () => {
    expect(() => createRenderer(document.createElement("canvas"))).toThrow(/2D canvas context/);
  });
});
