import { beforeEach, describe, expect, it } from "vitest";
import { wonderland } from "../board/boards/wonderland";
import type { Stroke } from "../core/geometry";
import type { Drawing, DrawingId } from "../ink/types";
import type { LiveRecognizer, Recognizer, Sighting } from "../recognition/types";
import { createCat } from "./index";
import { REFUSALS } from "./lines";
import { isAllowed } from "./natures";
import type { Cat, Nature, RoomBrief } from "./types";

const zoneOf = (id: string): RoomBrief => {
  const zone = wonderland.zones.find((candidate) => candidate.id === id);
  if (zone === undefined) throw new Error(`Wonderland has no zone called ${id}`);
  return zone;
};

const restricted = (id: string, allowedNatures: readonly Nature[]): RoomBrief => ({
  ...zoneOf(id),
  allowedNatures,
});

const hallOfDoors = zoneOf("hall-of-doors");
const inkOnlyRiverbank = restricted("riverbank", ["ink"]);
const shelves = restricted("shelves", [
  "ink",
  "bouncy",
  "climbable",
  "floaty",
  "heavy",
  "light",
  "slippery",
  "sticky",
]);
const sizeOnlyHall = restricted("hall-of-doors", ["ink", "heavy", "grow", "shrink"]);
const ROOMS: readonly RoomBrief[] = [...wonderland.zones, inkOnlyRiverbank, shelves, sizeOnlyHall];

const seeing = (...words: readonly string[]): Recognizer => ({
  recognize: () => Promise.resolve(words),
});

const sighting = (word: string, nature: Sighting["nature"] = "ink", certain = false): Sighting => ({
  word,
  confidence: 0.9,
  name: `${/^[aeiou]/.test(word) ? "an" : "a"} ${word}`,
  nature,
  strength: 1,
  line: `Ah. ${/^[aeiou]/.test(word) ? "An" : "A"} ${word}.`,
  certain,
});

const sightingsOf = (
  final: readonly Sighting[],
  partial: readonly Sighting[] = final,
): LiveRecognizer => ({
  recognize: () => Promise.resolve(final.map(({ word }) => word)),
  sight: (_, options) => Promise.resolve(options?.partial === true ? partial : final),
  complete: () => Promise.resolve(null),
  exemplar: () => Promise.resolve(null),
});

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
      const ruling = await cat.name(utterance, SKETCH);
      expect(ruling.nature).toBe(nature);
      expect(ruling.name).toBe(name);
      expect(ruling.strength).toBe(1);
    });

    it("hears people as walkers, not as laws on Alice", async () => {
      cat.enterRoom(hallOfDoors);
      expect(await cat.name("a little girl", SKETCH)).toMatchObject({
        nature: "walker",
        name: "a little girl",
      });
      expect(await cat.name("a hero", SKETCH)).toMatchObject({ nature: "walker", name: "a hero" });
    });

    it("knows which animals take to Alice and which run from her", async () => {
      cat.enterRoom(hallOfDoors);
      expect(await cat.name("a dog", SKETCH)).toMatchObject({
        nature: "walker",
        temper: "follows",
      });
      expect(await cat.name("a mouse", SKETCH)).toMatchObject({
        nature: "walker",
        temper: "flees",
      });
      expect(await cat.name("a tortoise", SKETCH)).not.toHaveProperty("temper");
    });

    it("lets a description overrule an animal's usual temper", async () => {
      cat.enterRoom(hallOfDoors);
      expect(await cat.name("a shy dog", SKETCH)).toMatchObject({ temper: "flees" });
      expect(await cat.name("a loyal mouse", SKETCH)).toMatchObject({ temper: "follows" });
      expect(await cat.name("a tortoise that follows alice", SKETCH)).toMatchObject({
        nature: "walker",
        temper: "follows",
      });
      expect(await cat.name("a friendly rock", SKETCH)).not.toHaveProperty("temper");
    });

    it("hears a portal as a portal, not as the goal", async () => {
      cat.enterRoom(hallOfDoors);
      expect(await cat.name("a portal", SKETCH)).toMatchObject({
        nature: "portal",
        name: "a portal",
      });
      expect(await cat.name("the looking glass", SKETCH)).toMatchObject({ nature: "portal" });
      expect(await cat.name("the exit", SKETCH)).toMatchObject({ nature: "goal" });
    });

    it("hears a car as something to drive", async () => {
      cat.enterRoom(hallOfDoors);
      expect(await cat.name("a car", SKETCH)).toMatchObject({ nature: "vehicle", name: "a car" });
      expect(await cat.name("a boat", SKETCH)).toMatchObject({ nature: "vehicle", name: "a boat" });
    });

    it("maps the book's labels onto size", async () => {
      cat.enterRoom(hallOfDoors);
      expect(await cat.name("eat me", SKETCH)).toMatchObject({ nature: "grow", name: "eat me" });
      expect(await cat.name("Drink Me", SKETCH)).toMatchObject({
        nature: "shrink",
        name: "drink me",
      });
      expect((await cat.name("a cup of tea", SKETCH)).nature).toBe("shrink");
      expect((await cat.name("a cake for Alice", SKETCH)).nature).toBe("grow");
    });

    it("scales strength with adjectives, inside the range", async () => {
      expect((await cat.name("a very bouncy mushroom", SKETCH)).strength).toBe(1.5);
      expect((await cat.name("a really really super huge rock", SKETCH)).strength).toBe(2);
      expect((await cat.name("a slightly bouncy mushroom", SKETCH)).strength).toBe(0.75);
      expect((await cat.name("a tiny little weak bit of a spring", SKETCH)).strength).toBe(0.5);
    });

    it("keeps a white rose as ink, but tags it", async () => {
      const ruling = await cat.name("a white rose", SKETCH);
      expect(ruling.nature).toBe("ink");
      expect(ruling.tags).toContain("rose");
    });

    it("refuses cake where cake isn't allowed, in character", async () => {
      const ruling = await cat.name("a cake", SKETCH);
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
      const ruling = await cat.name(utterance, SKETCH);
      expect(ruling.nature).toBe("ink");
      expect(ruling.line).toBe(line);
    });

    it("sends a helicopter up as the nearest honest nature", async () => {
      const ruling = await cat.name("a helicopter", SKETCH);
      expect(ruling.nature).toBe("floaty");
      expect(ruling.line).toBe("Near enough. Up it goes.");
    });

    it("admires a dot called a ladder", async () => {
      const ruling = await cat.name("a ladder", SHAPES.dot ?? drawingOf());
      expect(ruling.nature).toBe("climbable");
      expect(ruling.line).toBe("The smallest ladder I ever saw.");
      expect((await cat.name("a ladder", SKETCH)).line).not.toContain("smallest");
    });

    it("asks again when nothing is named", async () => {
      const ruling = await cat.name("   ", SKETCH);
      expect(ruling.nature).toBe("ink");
      expect(ruling.line).toBe(cat.askWhatItIs());
    });

    it("shrugs at the unknown, the same way every time", async () => {
      const first = await cat.name("my uncle's hat", SKETCH);
      const second = await cat.name("my uncle's hat", SKETCH);
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

  describe("guess", () => {
    it("reads a closed blob under a ledge as the usual suspects", async () => {
      expect(await cat.guess(SHAPES.round ?? drawingOf())).toEqual([
        "a mushroom",
        "a balloon",
        "a rock",
      ]);
    });

    it("sees a ladder in rails and rungs", async () => {
      expect((await cat.guess(SHAPES.ladder ?? drawingOf()))[0]).toBe("a ladder");
    });

    it("leans on the room: cake and bottle where only size matters", async () => {
      cat.enterRoom(sizeOnlyHall);
      expect(await cat.guess(SHAPES.round ?? drawingOf())).toEqual([
        "a cake",
        "a bottle",
        "a rock",
      ]);
    });

    it("always offers three distinct names the room would honour", async () => {
      const anythingGoes = createCat();
      for (const room of ROOMS.filter((candidate) => candidate !== inkOnlyRiverbank)) {
        for (const drawing of [...Object.values(SHAPES), drawingOf()]) {
          cat.enterRoom(room);
          const guesses = await cat.guess(drawing);
          expect(new Set(guesses).size).toBe(3);
          for (const guess of guesses) {
            const { nature } = await anythingGoes.name(guess, SKETCH);
            expect(isAllowed(nature, room.allowedNatures)).toBe(true);
          }
        }
      }
    });

    it("still finds three names where only ink exists", async () => {
      cat.enterRoom(inkOnlyRiverbank);
      expect(new Set(await cat.guess(SHAPES.flat ?? drawingOf())).size).toBe(3);
    });

    it("offers a platform for a flat line on an open board", async () => {
      cat.enterRoom(zoneOf("riverbank"));
      expect(await cat.guess(SHAPES.flat ?? drawingOf())).toEqual([
        "a plank",
        "a platform",
        "a trampoline",
      ]);
    });
  });

  describe("guess, with a recognizer", () => {
    const ROUND = SHAPES.round ?? drawingOf();

    const guessesIn = (room: RoomBrief, recognizer: Recognizer) => {
      const watchful = createCat(recognizer);
      watchful.enterRoom(room);
      return watchful.guess(ROUND);
    };

    it("says what was seen first, in the words he knows, and fills up with his hunch", async () => {
      expect(await guessesIn(hallOfDoors, seeing("birthday cake"))).toEqual([
        "a cake",
        "a mushroom",
        "a balloon",
      ]);
      expect(await guessesIn(hallOfDoors, seeing("hot air balloon", "wine bottle"))).toEqual([
        "a balloon",
        "a bottle",
        "a mushroom",
      ]);
    });

    it("keeps the recognizer's order, drops repeats and stops at three", async () => {
      const seen = seeing("stairs", "ladder", "birthday cake", "cake", "umbrella", "anvil");
      expect(await guessesIn(hallOfDoors, seen)).toEqual(["stairs", "a ladder", "a cake"]);
      expect(await guessesIn(hallOfDoors, seeing("umbrella", "anvil", "Umbrella"))).toEqual([
        "an umbrella",
        "an anvil",
        "a mushroom",
      ]);
    });

    it("does not call a bare shape a name", async () => {
      expect(await guessesIn(hallOfDoors, seeing("circle", "line", "mushroom"))).toEqual([
        "a mushroom",
        "a cake",
        "a balloon",
      ]);
    });

    it("prefers what the room would honour", async () => {
      expect(await guessesIn(shelves, seeing("birthday cake", "ladder", "house"))).toEqual([
        "a ladder",
        "a house",
        "a mushroom",
      ]);
    });

    it.each([
      ["sees nothing", seeing()],
      ["is offline", { recognize: () => Promise.reject(new Error("offline")) }],
    ] as const)("falls back to the hunch alone when the recognizer %s", async (_, recognizer) => {
      cat.enterRoom(shelves);
      expect(await guessesIn(shelves, recognizer)).toEqual(await cat.guess(ROUND));
      expect(await guessesIn(shelves, recognizer)).toEqual(["a mushroom", "a balloon", "a rock"]);
    });
  });

  describe("look and glimpse, with a live recognizer", () => {
    const ROUND = SHAPES.round ?? drawingOf();
    const watching = (recognizer: LiveRecognizer, room: RoomBrief = hallOfDoors) => {
      const watchful = createCat(recognizer);
      watchful.enterRoom(room);
      return watchful;
    };

    it("is sure only when the first sighting is marked certain, and rules it as seen", async () => {
      const sure = watching(sightingsOf([sighting("okapi", "walker", true), sighting("zebra")]));
      const look = await sure.look(ROUND);
      expect(look.certain).toMatchObject({ name: "an okapi", nature: "walker" });
      expect(look.guesses).toEqual(["an okapi", "a zebra", "a mushroom"]);

      const unsure = watching(sightingsOf([sighting("okapi", "walker"), sighting("zebra")]));
      expect((await unsure.look(ROUND)).certain).toBeNull();
      const older = watching(sightingsOf([sighting("okapi", "walker")]));
      expect((await older.look(ROUND)).certain).toBeNull();
    });

    it("is never sure of a bare shape, nor of a nature the room would not honour", async () => {
      const shape = watching(sightingsOf([sighting("circle", "ink", true)]));
      expect((await shape.look(ROUND)).certain).toBeNull();
      const creature = watching(sightingsOf([sighting("okapi", "walker", true)]), shelves);
      expect((await creature.look(ROUND)).certain).toBeNull();
    });

    it("lends the sighting's nature to a name the lexicon does not know", async () => {
      const cat = watching(
        sightingsOf([sighting("okapi", "walker"), sighting("numbat", "hopper")]),
      );
      expect((await cat.name("an okapi", ROUND)).nature).toBe("ink");
      await cat.look(ROUND);
      expect(await cat.name("an okapi", ROUND)).toMatchObject({
        name: "an okapi",
        nature: "walker",
        line: "Ah. An okapi.",
      });
      expect((await cat.name("a tall numbat", ROUND)).nature).toBe("hopper");
      expect((await cat.name("a bouncy okapi", ROUND)).nature).toBe("bouncy");
      expect((await cat.name("a sword", ROUND)).nature).toBe("ink");
      expect((await cat.name("a tapir", ROUND)).nature).toBe("ink");
    });

    it("accepts the offered nature and strength while typed descriptions keep their meaning", async () => {
      const cat = watching(
        sightingsOf([
          { ...sighting("baseball bat", "ink"), strength: 0.6 },
          { ...sighting("aircraft carrier", "heavy"), strength: 1.8 },
        ]),
      );
      const look = await cat.look(ROUND);
      expect(look.rulings.slice(0, 2)).toMatchObject([
        { name: "a baseball bat", nature: "ink", strength: 0.6 },
        { name: "an aircraft carrier", nature: "heavy", strength: 1.8 },
      ]);
      for (const offered of look.rulings) expect(cat.accept(offered)).toEqual(offered);
      expect((await cat.name("a baseball bat", ROUND)).nature).toBe("flier");
      expect((await cat.name("a bouncy aircraft carrier", ROUND)).nature).toBe("bouncy");
      expect((await cat.name("a very heavy aircraft carrier", ROUND)).strength).toBe(1.5);
    });

    it("filters guesses by their offered nature rather than their spelling", async () => {
      const cat = watching(
        sightingsOf([
          sighting("asparagus", "grow"),
          sighting("aircraft carrier", "heavy"),
          sighting("baseball bat", "ink"),
        ]),
        shelves,
      );
      const look = await cat.look(ROUND);
      expect(look.guesses).toEqual(["an aircraft carrier", "a baseball bat", "a mushroom"]);
      expect(look.rulings.map(({ nature }) => nature)).toEqual(["heavy", "ink", "bouncy"]);
    });

    it("rechecks room restrictions when accepting an earlier offer", async () => {
      const cat = watching(sightingsOf([{ ...sighting("asparagus", "grow"), strength: 1.8 }]));
      const [offered] = (await cat.look(ROUND)).rulings;
      if (offered === undefined) throw new Error("No offered ruling");
      cat.enterRoom(shelves);
      expect(cat.accept(offered)).toMatchObject({
        name: "an asparagus",
        nature: "ink",
        strength: 1,
        line: REFUSALS.forbidden,
      });
    });

    it("keeps an offer self-contained after other drawings displace the sighting cache", async () => {
      const cat = watching(sightingsOf([{ ...sighting("baseball", "bouncy"), strength: 1.4 }]));
      const [offered] = (await cat.look(ROUND)).rulings;
      if (offered === undefined) throw new Error("No offered ruling");
      for (let index = 0; index < 33; index++) {
        await cat.look({ ...ROUND, id: `later-${index}` as DrawingId });
      }
      expect(cat.accept(offered)).toMatchObject({ nature: "bouncy", strength: 1.4 });
    });

    it("glimpses the best honoured sighting of unfinished ink, or nothing", async () => {
      const cat = watching(sightingsOf([], [sighting("circle"), sighting("okapi", "walker")]));
      expect(await cat.glimpse(ROUND.strokes)).toMatchObject({ word: "okapi" });
      const shy = watching(sightingsOf([], []));
      expect(await shy.glimpse(ROUND.strokes)).toBeNull();
      const offline = watching({
        ...sightingsOf([]),
        sight: () => Promise.reject(new Error("offline")),
      });
      expect(await offline.glimpse(ROUND.strokes)).toBeNull();
      expect((await offline.look(ROUND)).guesses).toEqual(await cat.guess(ROUND));
    });
  });

  describe("name, for sketching a new game", () => {
    it.each([
      ["ground", "solid", "ground"],
      ["a platform", "solid", "a platform"],
      ["brick wall", "solid", "a brick wall"],
      ["the finish line", "goal", "the finish line"],
      ["rabbit hole", "goal", "a rabbit hole"],
      ["home", "goal", "a home"],
      ["lava", "hazard", "lava"],
      ["the floor is lava", "hazard", "the floor is lava"],
      ["spikes", "hazard", "spikes"],
      ["fire!", "hazard", "fire"],
      ["start", "spawn", "a start"],
      ["Alice starts here", "spawn", "alice starts here"],
      ["start here", "spawn", "start here"],
    ] as const)("hears %j as %s", async (utterance, nature, name) => {
      cat.enterRoom(hallOfDoors);
      const ruling = await cat.name(utterance, SKETCH);
      expect(ruling).toMatchObject({ nature, name, strength: 1 });
    });

    it("still reads a block of ice as slippery and a mushroom as bouncy", async () => {
      cat.enterRoom(hallOfDoors);
      expect((await cat.name("a block of ice", SKETCH)).nature).toBe("slippery");
      expect((await cat.name("a mushroom", SKETCH)).nature).toBe("bouncy");
    });
  });
});
