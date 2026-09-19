import type { Drawable } from "roughjs/bin/core";
import { describe, expect, it } from "vitest";
import { boardFor, DEMO_BOARD_ID } from "../board";
import type { BoardDefinition } from "../board/types";
import { expandRect } from "../core/geometry";
import { type ArtPiece, bowingFor, composeBoardArt, MAX_BOW_PX } from "./boardArt";
import { rectInView } from "./culling";
import { BOARD_COLORS } from "./palette";

const wonderland = boardFor(DEMO_BOARD_ID);
const blank = boardFor("my-own-game");
const HATCH_SLACK_PX = 4;
const NO_INK_ZONE = { x: 400, y: 300, width: 120, height: 80 };
const withNoInkZone: BoardDefinition = { ...blank, noInkZones: [NO_INK_ZONE] };

const isHatched = ({ sets }: Drawable): boolean => sets.some((set) => set.type === "fillSketch");
const hatchedIn = (pieces: readonly ArtPiece[]): readonly Drawable[] =>
  pieces.map((piece) => piece.drawable).filter(isHatched);

describe("composeBoardArt", () => {
  it.each([wonderland, blank])("sketches $id the same way every time", (board) => {
    expect(composeBoardArt(board)).toEqual(composeBoardArt(board));
  });

  it("hatches marker solids and the rabbit hole, and leaves glass clear", () => {
    const markerSolids = wonderland.solids.filter((solid) => solid.material === "marker");
    const { scenery } = composeBoardArt(wonderland);
    expect(scenery).toHaveLength(wonderland.solids.length + 1);
    expect(hatchedIn(scenery)).toHaveLength(markerSolids.length + 1);
    const glass = scenery.filter(
      (piece) => piece.drawable.options.stroke === BOARD_COLORS.glassEdge,
    );
    expect(glass).toHaveLength(1);
    expect(hatchedIn(glass)).toHaveLength(0);
  });

  it("hatches no-ink zones in red, with no outline", () => {
    const [zone] = composeBoardArt(withNoInkZone).scenery;
    expect(zone?.drawable.options.fill).toBe(BOARD_COLORS.noInk);
    expect(zone?.drawable.sets.map((set) => set.type)).toEqual(["fillSketch"]);
  });

  it("keeps the door apart so it can vanish when it opens", () => {
    expect(composeBoardArt(wonderland).door).not.toBeNull();
    expect(composeBoardArt(blank).door).toBeNull();
  });

  it("bounds every piece generously enough to cull by", () => {
    const { scenery } = composeBoardArt(wonderland);
    wonderland.solids.forEach((solid, index) => {
      const bounds = scenery[index]?.bounds;
      expect(bounds).toBeDefined();
      if (bounds === undefined) return;
      expect(bounds.x).toBeLessThan(solid.rect.x);
      expect(bounds.y).toBeLessThan(solid.rect.y);
      expect(bounds.x + bounds.width).toBeGreaterThan(solid.rect.x + solid.rect.width);
      expect(rectInView(bounds, { x: 50000, y: 0, width: 1000, height: 800 }, 0)).toBe(false);
    });
  });

  it("keeps every hatch line inside the solid it shades", () => {
    const { scenery } = composeBoardArt(wonderland);
    wonderland.solids.forEach((solid, index) => {
      const art = scenery[index];
      expect(art).toBeDefined();
      if (art === undefined) return;
      const { x, y, width, height } = expandRect(solid.rect, HATCH_SLACK_PX);
      const hatching = art.drawable.sets.filter((set) => set.type === "fillSketch");
      for (const { data } of hatching.flatMap((set) => set.ops)) {
        for (let at = 0; at + 1 < data.length; at += 2) {
          const [px = Number.NaN, py = Number.NaN] = data.slice(at, at + 2);
          expect(px).toBeGreaterThanOrEqual(x);
          expect(px).toBeLessThanOrEqual(x + width);
          expect(py).toBeGreaterThanOrEqual(y);
          expect(py).toBeLessThanOrEqual(y + height);
        }
      }
    });
  });

  it("keeps long marker lines from bowing away from the ground they stand for", () => {
    for (const { rect } of wonderland.solids) {
      const longest = Math.max(rect.width, rect.height);
      expect((bowingFor(rect) * longest) / 100).toBeLessThanOrEqual(MAX_BOW_PX + 1e-9);
    }
    expect(bowingFor({ x: 0, y: 0, width: 40, height: 40 })).toBe(1);
  });
});
