import { describe, expect, it } from "vitest";
import { placeWithin, visibleRect } from "./placement";

const FIELD = { width: 340, height: 44 };
const MARGIN = 12;
const IPAD = { x: 0, y: 0, width: 1180, height: 820 };
const IPAD_WITH_KEYBOARD = { ...IPAD, y: 40, height: 420 };

describe("placeWithin", () => {
  it("starts at the tap, centred on it vertically", () => {
    expect(placeWithin({ x: 400, y: 300 }, FIELD, IPAD, MARGIN)).toEqual({ x: 400, y: 278 });
  });

  it("pulls back from the right and bottom edges", () => {
    expect(placeWithin({ x: 1170, y: 815 }, FIELD, IPAD, MARGIN)).toEqual({ x: 828, y: 764 });
  });

  it("lifts above the on-screen keyboard and below a scrolled visual viewport", () => {
    expect(placeWithin({ x: 100, y: 700 }, FIELD, IPAD_WITH_KEYBOARD, MARGIN).y).toBe(404);
    expect(placeWithin({ x: 100, y: 10 }, FIELD, IPAD_WITH_KEYBOARD, MARGIN).y).toBe(52);
  });

  it("prefers the leading edge when the box cannot fit", () => {
    const narrow = { x: 0, y: 0, width: 300, height: 30 };

    expect(placeWithin({ x: 80, y: 20 }, FIELD, narrow, MARGIN)).toEqual({ x: 12, y: 12 });
  });
});

describe("visibleRect", () => {
  it("follows the visual viewport when the browser has one", () => {
    const visualViewport = { offsetLeft: 0, offsetTop: 40, width: 1180, height: 420 };
    const host = { innerWidth: 1180, innerHeight: 820, visualViewport } as unknown as Window;

    expect(visibleRect(host)).toEqual(IPAD_WITH_KEYBOARD);
  });

  it("falls back to the layout viewport", () => {
    const host = { innerWidth: 1180, innerHeight: 820, visualViewport: null } as unknown as Window;

    expect(visibleRect(host)).toEqual(IPAD);
  });
});
