import { describe, expect, it } from "vitest";
import type { Rect } from "../core/geometry";
import { judgePlacement } from "./placement";

const ALICE: Rect = { x: 100, y: 100, width: 28, height: 60 };

describe("judgePlacement", () => {
  it("accepts ink clear of Alice and the red paint", () => {
    const verdict = judgePlacement(
      [
        [
          { x: 0, y: 300 },
          { x: 400, y: 300 },
        ],
      ],
      {
        noInkZones: [{ x: 0, y: 0, width: 50, height: 50 }],
        solids: [],
        aliceBounds: ALICE,
      },
    );
    expect(verdict).toBe("ok");
  });

  it("catches a segment that passes through Alice with no point inside her", () => {
    const verdict = judgePlacement(
      [
        [
          { x: 0, y: 130 },
          { x: 400, y: 130 },
        ],
      ],
      { noInkZones: [], solids: [], aliceBounds: ALICE },
    );
    expect(verdict).toBe("overlaps-alice");
  });

  it("counts half the ink thickness as touching her", () => {
    const grazing = [
      [
        { x: 0, y: 163 },
        { x: 400, y: 163 },
      ],
    ];
    const clear = [
      [
        { x: 0, y: 170 },
        { x: 400, y: 170 },
      ],
    ];
    const rules = { noInkZones: [], solids: [], aliceBounds: ALICE };
    expect(judgePlacement(grazing, rules)).toBe("overlaps-alice");
    expect(judgePlacement(clear, rules)).toBe("ok");
  });

  it("treats a lone dot as a point", () => {
    const rules = { noInkZones: [], solids: [], aliceBounds: ALICE };
    expect(judgePlacement([[{ x: 110, y: 120 }]], rules)).toBe("overlaps-alice");
    expect(judgePlacement([[{ x: 300, y: 120 }]], rules)).toBe("ok");
  });

  it("puts red paint ahead of Alice", () => {
    const verdict = judgePlacement([[{ x: 110, y: 120 }]], {
      noInkZones: [{ x: 90, y: 90, width: 100, height: 100 }],
      solids: [],
      aliceBounds: ALICE,
    });
    expect(verdict).toBe("no-ink-zone");
  });

  it("catches a quick flick whose two points land either side of the red paint", () => {
    const flick = [
      [
        { x: 0, y: 400 },
        { x: 400, y: 400 },
      ],
    ];
    const rules = { solids: [], aliceBounds: null };
    expect(
      judgePlacement(flick, {
        ...rules,
        noInkZones: [{ x: 150, y: 300, width: 100, height: 200 }],
      }),
    ).toBe("no-ink-zone");
    expect(
      judgePlacement(flick, { ...rules, noInkZones: [{ x: 150, y: 0, width: 100, height: 200 }] }),
    ).toBe("ok");
  });

  it("rejects points beneath the ground but keeps solids and ditches drawable", () => {
    const solids = [{ x: 0, y: 100, width: 100, height: 20 }];
    expect(
      judgePlacement([[{ x: 50, y: 130 }]], { noInkZones: [], solids, aliceBounds: null }),
    ).toBe("under-ground");
    expect(
      judgePlacement([[{ x: 50, y: 110 }]], { noInkZones: [], solids, aliceBounds: null }),
    ).toBe("ok");
    expect(
      judgePlacement([[{ x: 150, y: 130 }]], { noInkZones: [], solids, aliceBounds: null }),
    ).toBe("ok");
  });
});
