import { describe, expect, it } from "vitest";
import { WakeWord } from "./wakeWord";

describe("WakeWord", () => {
  it("takes what follows his name in the same breath", () => {
    const wake = new WakeWord();
    expect(wake.heard("Kami, make gravity the moon's.")).toBe("make gravity the moon's");
    expect(wake.armed).toBe(false);
  });

  it("ignores talk that is not for him", () => {
    const wake = new WakeWord();
    expect(wake.heard("I think the ladder goes there.")).toBeNull();
  });

  it("waits for the next breath when only his name was said", () => {
    const wake = new WakeWord();
    expect(wake.heard("Kami?")).toBeNull();
    expect(wake.armed).toBe(true);
    expect(wake.heard("draw a ladder")).toBe("draw a ladder");
    expect(wake.armed).toBe(false);
    expect(wake.heard("draw another")).toBeNull();
  });

  it("answers to the ways Deepgram spells him", () => {
    const wake = new WakeWord();
    expect(wake.heard("Commie, help")).toBe("help");
    expect(wake.heard("Cami — make her small")).toBe("make her small");
    expect(wake.heard("KAMMY! fly")).toBe("fly");
  });

  it("answers to spellings nobody thought to list", () => {
    const wake = new WakeWord();
    expect(wake.heard("Kahmi, help")).toBe("help");
    expect(wake.heard("Qamee, help")).toBe("help");
    expect(wake.heard("Karma, help")).toBe("help");
  });

  it("hears his name written as two words", () => {
    const wake = new WakeWord();
    expect(wake.heard("Cam me, gravity off")).toBe("gravity off");
    expect(wake.heard("Car me, gravity off")).toBe("gravity off");
  });

  it("stays asleep through plain English that sounds like him", () => {
    const wake = new WakeWord();
    expect(wake.heard("come over here")).toBeNull();
    expect(wake.heard("she came down")).toBeNull();
    expect(wake.heard("put a comma there")).toBeNull();
  });

  it("only hears him where his name is, not inside another word", () => {
    const wake = new WakeWord();
    expect(wake.heard("the origami crane")).toBeNull();
    expect(wake.heard("the camera is heavy")).toBeNull();
  });

  it("forgets that it was woken", () => {
    const wake = new WakeWord();
    wake.heard("kami");
    wake.forget();
    expect(wake.armed).toBe(false);
    expect(wake.heard("make her fly")).toBeNull();
  });
});
