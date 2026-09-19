import { beforeEach, describe, expect, it } from "vitest";
import type { Stroke } from "../core/geometry";
import { hallOfDoors } from "../game/levels/hallOfDoors";
import { LEVELS } from "../game/levels/index";
import { riverbank } from "../game/levels/riverbank";
import { shelves } from "../game/levels/shelves";
import type { Drawing, DrawingId } from "../ink/types";
import { NO_FACTS } from "../world/types";
import { createCat } from "./index";
import { REFUSALS } from "./lines";
import { isAllowed } from "./natures";
import type { Cat } from "./types";

const drawingOf = (...strokes: Stroke[]): Drawing => ({
  id: "fixture" as DrawingId,
  strokes,
  cost: 0,
});

const ellipse = (rx: number, ry: number): Stroke =>
  Array.from({ length: 25 }, (_, i) => ({
    x: 400 + rx * Math.cos((i / 24) * 2 * Math.PI),
    y: 400 + ry * Math.sin((i / 24) * 2 * Math.PI),
  }));

const line = (x0: number, y0: number, x1: number, y1: number): Stroke => [
  { x: x0, y: y0 },
  { x: x1, y: y1 },
];

const SKETCH = drawingOf(ellipse(40, 30));

const SHAPES: Readonly<Record<string, Drawing>> = {
  round: drawingOf(ellipse(50, 45)),
  flat: drawingOf(line(100, 300, 400, 310)),
  ladder: drawingOf(line(100, 100, 100, 400), line(150, 100, 150, 400), line(100, 200, 150, 200)),
  blob: drawingOf([
    { x: 0, y: 0 },
    { x: 80, y: 10 },
    { x: 70, y: 90 },
  ]),
  dot: drawingOf(ellipse(5, 5)),
};

describe("ScriptedCat", () => {
  let cat: Cat;

  beforeEach(() => {
    cat = createCat();
    cat.enterRoom(shelves);
  });

  describe("name", () => {
    it.each([
      ["it's a bouncy mushroom", "bouncy", "a bouncy mushroom"],
      ["this is a rock", "heavy", "a rock"],
      ["Ladder", "climbable", "a ladder"],
      ["that's a balloon!", "floaty", "a balloon"],
      ["sticky", "sticky", "something sticky"],
      ["heavy thing", "heavy", "a heavy thing"],
      ["some stairs", "climbable", "some stairs"],
      ["soap", "slippery", "soap"],
      ["a feather", "light", "a feather"],
      ["a paper plane", "light", "a paper plane"],
      ["bubble gum", "sticky", "bubble gum"],
    ] as const)("hears %j as %s", async (utterance, nature, name) => {
      const ruling = await cat.name(utterance, SKETCH, NO_FACTS);
      expect(ruling.nature).toBe(nature);
      expect(ruling.name).toBe(name);
      expect(ruling.strength).toBe(1);
    });

    it("maps the book's labels onto size", async () => {
      cat.enterRoom(hallOfDoors);
      expect(await cat.name("eat me", SKETCH, NO_FACTS)).toMatchObject({
        nature: "grow",
        name: "eat me",
      });
      expect(await cat.name("Drink Me", SKETCH, NO_FACTS)).toMatchObject({
        nature: "shrink",
        name: "drink me",
      });
      expect((await cat.name("a cup of tea", SKETCH, NO_FACTS)).nature).toBe("shrink");
      expect((await cat.name("a cake for Alice", SKETCH, NO_FACTS)).nature).toBe("grow");
    });

    it("scales strength with adjectives, inside the range", async () => {
      expect((await cat.name("a very bouncy mushroom", SKETCH, NO_FACTS)).strength).toBe(1.5);
      expect((await cat.name("a really really super huge rock", SKETCH, NO_FACTS)).strength).toBe(
        2,
      );
      expect((await cat.name("a slightly bouncy mushroom", SKETCH, NO_FACTS)).strength).toBe(0.75);
      expect(
        (await cat.name("a tiny little weak bit of a spring", SKETCH, NO_FACTS)).strength,
      ).toBe(0.5);
    });

    it("keeps a white rose as ink, but tags it", async () => {
      const ruling = await cat.name("a white rose", SKETCH, NO_FACTS);
      expect(ruling.nature).toBe("ink");
      expect(ruling.tags).toContain("rose");
    });

    it("refuses cake where cake isn't allowed, in character", async () => {
      const ruling = await cat.name("a cake", SKETCH, NO_FACTS);
      expect(ruling).toMatchObject({ nature: "ink", strength: 1, name: "a cake" });
      expect(ruling.line).toBe("No cake down here. It's only ink.");
    });

    it.each([
      ["a jetpack for Alice", REFUSALS.alice],
      ["make Alice fly", REFUSALS.alice],
      ["make her bigger", REFUSALS.alice],
      ["make the door bigger", REFUSALS.room],
      ["remove the wall", REFUSALS.room],
      ["It's a key", REFUSALS.key],
      ["a sword", REFUSALS.weapon],
    ] as const)("rules %j plain ink with the authored line", async (utterance, line) => {
      cat.enterRoom({ ...shelves, allowedNatures: "all" });
      const ruling = await cat.name(utterance, SKETCH, NO_FACTS);
      expect(ruling.nature).toBe("ink");
      expect(ruling.line).toBe(line);
    });

    it("sends a helicopter up as the nearest honest nature", async () => {
      const ruling = await cat.name("a helicopter", SKETCH, NO_FACTS);
      expect(ruling.nature).toBe("floaty");
      expect(ruling.line).toBe("Near enough. Up it goes.");
    });

    it("admires a dot called a ladder", async () => {
      const ruling = await cat.name("a ladder", SHAPES.dot ?? drawingOf(), NO_FACTS);
      expect(ruling.nature).toBe("climbable");
      expect(ruling.line).toBe("The smallest ladder I ever saw.");
      expect((await cat.name("a ladder", SKETCH, NO_FACTS)).line).not.toContain("smallest");
    });

    it("asks again when nothing is named", async () => {
      const ruling = await cat.name("   ", SKETCH, NO_FACTS);
      expect(ruling.nature).toBe("ink");
      expect(ruling.line).toBe(cat.askWhatItIs());
    });

    it("shrugs at the unknown, the same way every time", async () => {
      const first = await cat.name("my uncle's hat", SKETCH, NO_FACTS);
      const second = await cat.name("my uncle's hat", SKETCH, NO_FACTS);
      expect(first).toMatchObject({ nature: "ink", name: "my uncle's hat" });
      expect(second.line).toBe(first.line);
    });
  });

  describe("hint", () => {
    it("climbs one rung per ask and stays on the answer", () => {
      cat.enterRoom(hallOfDoors);
      const asked = [cat.hint(), cat.hint(), cat.hint(), cat.hint()];
      expect(asked.map((hint) => hint.tier)).toEqual([1, 2, 3, 3]);
      expect(asked.map((hint) => hint.line)).toEqual([...hallOfDoors.hints, hallOfDoors.hints[2]]);
    });

    it("starts from the bottom in a new room", () => {
      cat.hint();
      cat.hint();
      cat.enterRoom(hallOfDoors);
      expect(cat.hint()).toEqual({ tier: 1, line: hallOfDoors.hints[0] });
    });
  });

  describe("offerHelp", () => {
    it("offers once per room", () => {
      expect(cat.offerHelp()).toBe("Ask, if you like.");
      expect(cat.offerHelp()).toBeNull();
      cat.enterRoom(hallOfDoors);
      expect(cat.offerHelp()).toBe("Ask, if you like.");
    });
  });

  describe("look", () => {
    it("reads a closed blob under a ledge as the usual suspects", async () => {
      expect(await guessesOf(cat, SHAPES.round ?? drawingOf())).toEqual([
        "a mushroom",
        "a balloon",
        "a rock",
      ]);
    });

    it("sees a ladder in rails and rungs", async () => {
      expect((await guessesOf(cat, SHAPES.ladder ?? drawingOf()))[0]).toBe("a ladder");
    });

    it("leans on the room: cake and bottle in the Hall of Doors", async () => {
      cat.enterRoom(hallOfDoors);
      expect(await guessesOf(cat, SHAPES.round ?? drawingOf())).toEqual([
        "a cake",
        "a bottle",
        "a rock",
      ]);
    });

    it("always offers three distinct names the room would honour", async () => {
      for (const level of LEVELS) {
        for (const drawing of [...Object.values(SHAPES), drawingOf()]) {
          cat.enterRoom(level);
          const guesses = await guessesOf(cat, drawing);
          expect(new Set(guesses).size).toBe(3);
          for (const guess of guesses) {
            const { nature } = await createCatIn("all").name(guess, SKETCH, NO_FACTS);
            expect(isAllowed(nature, level.allowedNatures)).toBe(true);
          }
        }
      }
    });

    it("still finds three names where only ink exists", async () => {
      cat.enterRoom(riverbank);
      expect(new Set(await guessesOf(cat, SHAPES.flat ?? drawingOf())).size).toBe(3);
    });
  });
});

const guessesOf = async (cat: Cat, drawing: Drawing): Promise<readonly string[]> => {
  const glance = await cat.look(drawing, () => "", NO_FACTS);
  return glance.kind === "picture" ? glance.guesses : [];
};

const createCatIn = (allowedNatures: "all"): Cat => {
  const cat = createCat();
  cat.enterRoom({ ...shelves, allowedNatures });
  return cat;
};
