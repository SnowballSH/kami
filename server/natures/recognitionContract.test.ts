import { describe, expect, it } from "vitest";
import { createCat } from "../../src/cat";
import { IdMint } from "../../src/game/idMint";
import type { Drawing } from "../../src/ink/types";
import { HttpRecognizer } from "../../src/recognition/httpRecognizer";
import { quickdrawNatureTable } from "./natureTable";

const drawing: Drawing = {
  id: new IdMint().next("drawing"),
  strokes: [
    [
      { x: 0, y: 0 },
      { x: 80, y: 30 },
    ],
  ],
  cost: 0,
};

const UNNAMED_SHAPES = new Set([
  "circle",
  "hexagon",
  "line",
  "octagon",
  "squiggle",
  "square",
  "triangle",
  "zigzag",
]);

describe("reviewed recognition rulings across the HTTP/client contract", () => {
  it.each(quickdrawNatureTable.categories)(
    "preserves %s, including canonical aliases",
    async (category) => {
      const word = quickdrawNatureTable.canonical(category);
      const description = quickdrawNatureTable.describe(category);
      for (const certain of [false, true]) {
        const cat = createCat(
          new HttpRecognizer(async () =>
            Response.json({
              guesses: [word],
              confidence: [0.9],
              names: [description.name],
              natures: [description.nature],
              strengths: [description.strength],
              lines: [description.line],
              certain,
            }),
          ),
        );
        const look = await cat.look(drawing);
        expect(look.rulings.map(({ name }) => name)).toEqual(look.guesses);
        const offered = look.rulings.find(({ name }) => name === description.name);
        if (UNNAMED_SHAPES.has(category)) {
          expect(offered).toBeUndefined();
          expect(look.certain).toBeNull();
          continue;
        }
        if (offered === undefined) throw new Error(`No offered ruling for ${category}`);
        const expected = { ...description, tags: [] };
        expect(cat.accept(offered)).toEqual(expected);
        expect(look.certain).toEqual(certain ? expected : null);
      }
    },
  );

  it("keeps the bare-shape exclusion allowlist limited to existing categories", () => {
    for (const word of UNNAMED_SHAPES) expect(quickdrawNatureTable.categories).toContain(word);
  });
});
