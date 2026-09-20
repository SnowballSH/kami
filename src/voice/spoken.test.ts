import { describe, expect, it } from "vitest";
import { spoken } from "./spoken";

describe("spoken", () => {
  it("leaves a plain command alone", () => {
    expect(spoken("make gravity the moon's")).toBe("make gravity the moon's");
  });

  it("drops hesitation wherever it falls", () => {
    expect(spoken("uh, make her fly")).toBe("make her fly");
    expect(spoken("make gravity, um, the moon's")).toBe("make gravity, the moon's");
    expect(spoken("erm draw a ladder")).toBe("draw a ladder");
  });

  it("drops the run-up to the command", () => {
    expect(spoken("okay so draw a ladder")).toBe("draw a ladder");
    expect(spoken("Hey, can you make her small")).toBe("make her small");
  });

  it("drops a run-up that Deepgram punctuated into sentences", () => {
    expect(spoken("Okay. Now turn gravity off, please.")).toBe("turn gravity off");
    expect(spoken("Okay. Then turn gravity off.")).toBe("turn gravity off");
  });

  it("drops politeness at the end", () => {
    expect(spoken("turn gravity off, please.")).toBe("turn gravity off");
  });

  it("keeps words that only look like filler", () => {
    expect(spoken("the umbrella is heavy")).toBe("the umbrella is heavy");
    expect(spoken("make her hair long")).toBe("make her hair long");
  });

  it("is empty when nothing but filler was said", () => {
    expect(spoken("uh, um…")).toBe("");
  });
});
