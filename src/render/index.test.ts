import { describe, expect, it } from "vitest";
import type { Handwriting } from "../handwriting/types";
import { createRenderer } from "./index";

const SILENT: Handwriting = {
  write: (text) => ({
    text,
    strokes: [],
    startsAtMs: [],
    endsAtMs: [],
    durationMs: 0,
    bounds: { x: 0, y: 0, width: 0, height: 0 },
  }),
  reveal: () => [],
};

describe("createRenderer", () => {
  it("says so plainly when the canvas has no 2D context", () => {
    expect(() => createRenderer(document.createElement("canvas"), SILENT)).toThrow(
      /2D canvas context/,
    );
  });
});
