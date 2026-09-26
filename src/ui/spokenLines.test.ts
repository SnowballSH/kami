import { describe, expect, it } from "vitest";
import { KEPT_LINES, REPEAT_QUIET_MS, SpokenLines } from "./spokenLines";

const setup = () => {
  const clock = { nowMs: 0 };
  const spoken = new SpokenLines(() => clock.nowMs);
  const lines = (): readonly (string | null)[] =>
    [...spoken.element.children].map((line) => line.textContent);
  return { clock, spoken, lines };
};

describe("SpokenLines", () => {
  it("is a polite status region that stays out of sight", () => {
    const { spoken } = setup();
    expect(spoken.element.getAttribute("role")).toBe("status");
    expect(spoken.element.getAttribute("aria-live")).toBe("polite");
    expect(spoken.element.className).toBe("kami-visually-hidden");
  });

  it("says a repeated line again only once the quiet has passed", () => {
    const { clock, spoken, lines } = setup();
    spoken.say("Mind the gap.");
    clock.nowMs = REPEAT_QUIET_MS - 1;
    spoken.say("Mind the gap.");
    expect(lines()).toEqual(["Mind the gap."]);

    clock.nowMs = REPEAT_QUIET_MS;
    spoken.say(" Mind the gap. ");
    expect(lines()).toEqual(["Mind the gap.", "Mind the gap."]);
  });

  it("keeps only the latest few lines", () => {
    const { spoken, lines } = setup();
    for (let index = 0; index < KEPT_LINES + 2; index++) spoken.say(`line ${index}`);
    expect(lines()).toHaveLength(KEPT_LINES);
    expect(lines().at(-1)).toBe(`line ${KEPT_LINES + 1}`);
  });
});
