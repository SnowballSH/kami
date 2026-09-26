import { describe, expect, it } from "vitest";
import { VERBS } from "./verbs";

describe("the doing words a drawing's name stops at", () => {
  it("knows each verb as it follows a name: bare, present, progressive and past", () => {
    for (const word of [
      "drift",
      "flies",
      "flew",
      "swims",
      "swimming",
      "hops",
      "hopped",
      "drives",
      "gliding",
      "buzzes",
      "lying",
      "holds",
      "stays",
    ]) {
      expect(VERBS.has(word), word).toBe(true);
    }
  });

  it("leaves out words that as often end a two-word name", () => {
    for (const word of ["leaves", "swing", "shake", "skate", "rose", "fell", "pads", "truck"]) {
      expect(VERBS.has(word), word).toBe(false);
    }
  });
});
