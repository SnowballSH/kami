import { describe, expect, it, vi } from "vitest";
import { boundsOf, type Vec } from "../core/geometry";
import { ARRIVAL_MS } from "../ink/retrace";
import type { Completion, Exemplar } from "../recognition/types";
import type { Scene } from "../rules/types";
import { SUMMONED_SIZE } from "../summoning";
import {
  CANNOT_DRAW_LINE,
  NOWHERE_LINE,
  PONDERING_LINE,
  SUMIKUI_SUMMONED_LINES,
} from "./kami/lines";
import { blob, COMMIT_WAIT_MS, Eyes, line, Player, seen } from "./testing/player";

describe("Game with Kami's eyes on the ink", () => {
  const sketch = async (player: Player, points: readonly Vec[]): Promise<void> => {
    player.use("draw");
    const [first, ...rest] = points;
    if (first === undefined) return;
    player.game.penDown(first);
    for (const point of rest) player.game.penMove(point);
    player.game.penUp();
    await player.wait(50);
  };

  it("pencils in a guess between strokes, keeps quiet on nothing, and clears it once the ink settles", async () => {
    const eyes = new Eyes([seen("mushroom", "bouncy")], []);
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await sketch(player, blob({ x: 300, y: 530 }, 30, 20));
    expect(player.written).toContain("a mushroom?");
    expect(eyes.asked).toEqual([{ strokes: 1, partial: true }]);

    await sketch(player, line({ x: 270, y: 530 }, { x: 330, y: 530 }));
    expect(player.written.filter((text) => text === "a mushroom?")).toHaveLength(1);
    expect(eyes.asked.at(-1)).toEqual({ strokes: 2, partial: true });

    await player.wait(COMMIT_WAIT_MS);
    const notes = player.renderer.lastFrame?.notes ?? [];
    expect(notes.filter((note) => note.script.text === "a mushroom?" && !note.tappable)).toEqual(
      [],
    );
    expect(eyes.asked.at(-1)).toEqual({ strokes: 2, partial: false });
    expect(notes.filter((note) => note.tappable)).toHaveLength(3);
  });

  it("labels a drawing himself when he is certain, and lets a written name overrule him", async () => {
    const eyes = new Eyes([], [seen("okapi", "walker", true), seen("zebra", "walker")]);
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.wait(100);
    expect(player.written).toContain("an okapi");
    expect(player.renderer.lastFrame?.notes.filter((note) => note.tappable)).toHaveLength(0);
    const [stored] = (await player.store.load("wonderland")).drawings;
    expect(stored?.ruling).toMatchObject({ name: "an okapi", nature: "walker" });
    expect((await player.store.load("wonderland")).notes.map((note) => note.text)).toEqual([
      "an okapi",
    ]);

    await player.write("a rock", { x: 300, y: 470 });
    expect(player.written).not.toContain("an okapi");
    const [renamed] = (await player.store.load("wonderland")).drawings;
    expect(renamed?.ruling).toMatchObject({ name: "a rock", nature: "heavy" });
    expect((await player.store.load("wonderland")).notes.map((note) => note.text)).toEqual([
      "a rock",
    ]);
  });

  it("offers guesses as usual when he is not certain", async () => {
    const player = new Player("wonderland", {
      eyes: new Eyes([], [seen("okapi", "walker"), seen("zebra", "walker")]),
    });
    await player.arrive();
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.wait(100);
    const guesses = player.renderer.lastFrame?.notes.filter((note) => note.tappable) ?? [];
    expect(guesses.map((note) => note.script.text)).toEqual([
      "an okapi?",
      "a zebra?",
      "a mushroom?",
    ]);
  });

  it.each([
    seen("baseball bat", "ink"),
    seen("aircraft carrier", "heavy"),
    seen("baseball", "bouncy"),
    seen("asparagus", "grow"),
  ])("carries $word's offered ruling through a tap, simulation and storage", async (sighting) => {
    const offered = { ...sighting, strength: 1.7 };
    const player = new Player("wonderland", { eyes: new Eyes([], [offered]) });
    await player.arrive();
    await player.draw(blob({ x: 300, y: 430 }, 30, 20));
    await player.wait(100);
    const guess = player.renderer.lastFrame?.notes.find(
      (note) => note.tappable && note.script.text === `${offered.name}?`,
    );
    if (guess === undefined) throw new Error("No canonical guess to tap");
    const { x, y, width, height } = guess.script.bounds;
    player.game.tap({ x: x + width / 2, y: y + height / 2 });
    await player.wait(100);

    const expected = {
      name: offered.name,
      nature: offered.nature,
      strength: offered.strength,
      line: offered.line,
      tags: [],
    };
    const board = await player.store.load("wonderland");
    expect(board.drawings[0]?.ruling).toEqual(expected);
    expect(player.renderer.lastFrame?.inks[0]?.nature).toBe(offered.nature);
    expect(board.notes.some((note) => note.action !== undefined)).toBe(false);
    expect(player.renderer.lastFrame?.notes.filter((note) => note.tappable)).toHaveLength(0);
  });

  it("never auto-accepts a certain partial sighting", async () => {
    const player = new Player("wonderland", {
      eyes: new Eyes([seen("aircraft carrier", "heavy", true)], []),
    });
    await player.arrive();
    await sketch(player, blob({ x: 300, y: 430 }, 30, 20));
    expect((await player.store.load("wonderland")).drawings).toHaveLength(0);
    await player.wait(COMMIT_WAIT_MS);
    expect((await player.store.load("wonderland")).drawings[0]?.ruling).toBeNull();
    expect(player.renderer.lastFrame?.notes.filter((note) => note.tappable)).toHaveLength(3);
  });
});

describe("Game with a Kami who tidies", () => {
  const lifted = (strokes: readonly Vec[][]): Vec[][] =>
    strokes.map((stroke) => stroke.map(({ x, y }) => ({ x, y: y - 3 })));
  const flourish: Vec[] = [
    { x: 300, y: 480 },
    { x: 310, y: 470 },
    { x: 320, y: 480 },
  ];

  it("glides a named drawing into its tidied strokes, draws in what was missing, and saves it", async () => {
    const eyes = new Eyes([], [seen("mushroom", "bouncy", true)]);
    eyes.tidy = (strokes) => ({
      tidied: lifted(strokes),
      added: [flourish],
      word: "mushroom",
      confidence: 0.9,
    });
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    expect(eyes.tidiedAs).toEqual(["a mushroom"]);
    const drawn = (await player.store.load("wonderland")).drawings[0]?.drawing.strokes ?? [];
    expect(drawn).toHaveLength(2);
    expect(drawn[1]).toEqual(flourish);

    await player.wait(800);
    const shown = player.renderer.lastFrame?.inks[0]?.drawing.strokes ?? [];
    expect(shown).toEqual(drawn);
    expect(player.renderer.lastFrame?.inks[0]?.nature).toBe("bouncy");
  });

  it("shows the ink on its way there, never jumping", async () => {
    const eyes = new Eyes([], [seen("mushroom", "bouncy", true)]);
    eyes.tidy = (strokes) => ({
      tidied: lifted(strokes),
      added: [],
      word: "mushroom",
      confidence: 1,
    });
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    const saved = (await player.store.load("wonderland")).drawings[0]?.drawing.strokes ?? [];
    const onTheWay = player.renderer.lastFrame?.inks[0]?.drawing.strokes ?? [];
    const lift = (saved[0]?.[0]?.y ?? 0) - (onTheWay[0]?.[0]?.y ?? 0);
    expect(onTheWay[0]).toHaveLength(saved[0]?.length ?? -1);
    expect(Math.abs(lift)).toBeLessThanOrEqual(3);
  });

  it("tidies toward the name that stands, not one the player corrected meanwhile", async () => {
    const eyes = new Eyes([], [seen("mushroom", "bouncy", true)]);
    const answers: ((completion: Completion | null) => void)[] = [];
    eyes.complete = (strokes, name) => {
      eyes.tidiedAs.push(name);
      return new Promise((resolve) => {
        answers.push((completion) =>
          resolve(completion ?? { ...tidyAs(strokes), word: name ?? "" }),
        );
      });
    };
    const tidyAs = (strokes: readonly Vec[][]) => ({
      tidied: lifted(strokes),
      added: [],
      word: "",
      confidence: 1,
    });
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.write("a ladder", { x: 300, y: 500 });
    expect(eyes.tidiedAs).toEqual(["a mushroom"]);

    answers.shift()?.(null);
    await player.wait(50);
    expect(eyes.tidiedAs).toEqual(["a mushroom", "a ladder"]);
    const untouched = (await player.store.load("wonderland")).drawings[0]?.drawing.strokes ?? [];

    answers.shift()?.(null);
    await player.wait(50);
    const saved = (await player.store.load("wonderland")).drawings[0];
    expect(saved?.ruling?.nature).toBe("climbable");
    expect(saved?.drawing.strokes[0]?.[0]?.y).toBe((untouched[0]?.[0]?.y ?? 0) - 3);
  });

  it("tidies what is already named again when the slider comes to rest, always from the ink as drawn", async () => {
    const eyes = new Eyes([], [seen("mushroom", "bouncy", true)]);
    const asked: { firstY: number; firmness: number | undefined }[] = [];
    eyes.complete = (strokes, _name, firmness) => {
      asked.push({ firstY: strokes[0]?.[0]?.y ?? Number.NaN, firmness });
      const lift = 10 * (firmness ?? 0);
      return Promise.resolve({
        tidied: strokes.map((stroke) => stroke.map(({ x, y }) => ({ x, y: y - lift }))),
        added: [],
        word: "mushroom",
        confidence: 1,
      });
    };
    const player = new Player("wonderland", { eyes });
    await player.arrive();
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    const drawnY = asked[0]?.firstY ?? Number.NaN;
    const savedY = async () =>
      (await player.store.load("wonderland")).drawings[0]?.drawing.strokes[0]?.[0]?.y;
    expect(await savedY()).toBeCloseTo(drawnY - 5);

    player.hud.handlers.onTidinessChanged(0.8);
    player.hud.handlers.onTidinessChanged(1);
    await player.wait(600);
    expect(asked.map(({ firmness }) => firmness)).toEqual([0.5, 1]);
    expect(asked[1]?.firstY).toBe(drawnY);
    expect(await savedY()).toBeCloseTo(drawnY - 10);

    player.hud.handlers.onTidinessChanged(0);
    await player.wait(600);
    expect(asked).toHaveLength(2);
    expect(await savedY()).toBe(drawnY);
  });

  it("tidies as firmly as the slider says, and not at all when it is all the way down", async () => {
    const eyes = new Eyes([], [seen("mushroom", "bouncy", true)]);
    const firmnesses: (number | undefined)[] = [];
    eyes.complete = (_strokes, _name, firmness) => {
      firmnesses.push(firmness);
      return Promise.resolve(null);
    };
    const player = new Player("wonderland", { eyes });
    await player.arrive();
    expect(player.hud.tidiness).toBe(0.5);

    player.hud.handlers.onTidinessChanged(0.9);
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    player.hud.handlers.onTidinessChanged(0);
    await player.draw(blob({ x: 500, y: 530 }, 30, 20));
    expect(firmnesses).toEqual([0.9]);
  });

  it("leaves the player's ink exactly as drawn when Kami has nothing to offer", async () => {
    const eyes = new Eyes([], [seen("mushroom", "bouncy", true)]);
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.wait(800);
    expect(eyes.tidiedAs).toEqual(["a mushroom"]);
    const saved = (await player.store.load("wonderland")).drawings[0]?.drawing.strokes ?? [];
    expect(player.renderer.lastFrame?.inks[0]?.drawing.strokes).toEqual(saved);
    expect(saved).toHaveLength(1);
  });
});

describe("Game with a Kami who draws", () => {
  const KNOWN = ["rabbit", "house", "tree", "cloud", "ladder"];
  const RABBIT: Exemplar = {
    word: "rabbit",
    strokes: [
      [
        { x: 20, y: 200 },
        { x: 120, y: 200 },
        { x: 220, y: 200 },
      ],
      [
        { x: 60, y: 200 },
        { x: 60, y: 40 },
      ],
      [
        { x: 180, y: 200 },
        { x: 180, y: 40 },
      ],
    ],
  };
  const drawer = () => {
    const eyes = new Eyes([], [], KNOWN);
    eyes.pictures.set("rabbit", RABBIT);
    return eyes;
  };

  it("takes a bare name beside unnamed ink as its name rather than drawing one", async () => {
    const eyes = drawer();
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.write("a ladder", { x: 300, y: 500 });
    expect(eyes.summoned).toEqual([]);
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual(["climbable"]);
  });

  it("draws what is asked for outright even beside unnamed ink, leaving that ink unnamed", async () => {
    const eyes = drawer();
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.write("summon a rabbit", { x: 300, y: 500 });
    expect(eyes.summoned).toEqual(["rabbit"]);
    const natures = player.renderer.lastFrame?.inks.map((ink) => ink.nature) ?? [];
    expect(natures).toContain("ink");
    expect(natures).toContain("hopper");
  });

  it("lets the player's words and Kami's label fade once they have been answered", async () => {
    const eyes = drawer();
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    const standing = player.written;
    await player.write("summon a rabbit", { x: 300, y: 500 });
    expect(player.written).toContain("summon a rabbit");
    expect(player.written.length).toBeGreaterThan(standing.length + 1);

    await player.wait(20_000);
    expect(player.written.filter((text) => !standing.includes(text))).toEqual([]);
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual(["hopper"]);
    expect((await player.store.load("wonderland")).notes).toEqual([]);
  });

  it("inks the picture asked for above the words, stroke by stroke, and names it", async () => {
    const eyes = drawer();
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.write("summon a rabbit", { x: 300, y: 500 });
    expect(eyes.summoned).toEqual(["rabbit"]);
    const onTheWay = player.renderer.lastFrame?.inks[0]?.drawing.strokes ?? [];
    expect(onTheWay.length).toBeLessThan(RABBIT.strokes.length);

    await player.wait(ARRIVAL_MS);
    const saved = (await player.store.load("wonderland")).drawings[0];
    expect(saved?.ruling?.nature).toBe("hopper");
    expect(saved?.drawing.strokes).toHaveLength(RABBIT.strokes.length);
    expect(player.renderer.lastFrame?.inks[0]?.drawing.strokes).toEqual(saved?.drawing.strokes);
    expect(player.sim.snapshot().drawings.map(({ id }) => id)).toEqual([saved?.drawing.id]);
    expect(eyes.tidiedAs).toEqual([]);

    const drawn = boundsOf(saved?.drawing.strokes.flat() ?? []);
    expect(Math.max(drawn.width, drawn.height)).toBeCloseTo(SUMMONED_SIZE.usual, 5);
    expect(drawn.y + drawn.height).toBeLessThan(500);
    expect(player.written).toContain("summon a rabbit");
    expect(player.written.some((text) => text !== "summon a rabbit")).toBe(true);
  });

  it("summons a whole scene in a row over the words, each thing named", async () => {
    const eyes = drawer();
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.write("a house, a tree and two clouds", { x: 300, y: 500 });
    expect(eyes.summoned).toEqual(["house", "tree", "cloud", "cloud"]);
    await player.wait(ARRIVAL_MS);
    const inks = player.renderer.lastFrame?.inks ?? [];
    expect(inks.map((ink) => ink.nature)).toEqual(["heavy", "climbable", "floaty", "floaty"]);
    const boxes = inks.map((ink) => boundsOf(ink.drawing.strokes.flat()));
    const lefts = boxes.map((box) => box.x);
    expect([...lefts].sort((a, b) => a - b)).toEqual(lefts);
    for (const box of boxes) expect(box.y + box.height).toBeLessThan(500);
    expect(player.written).toEqual(expect.arrayContaining(["a house", "a tree", "a cloud"]));
    expect((await player.store.load("wonderland")).drawings).toHaveLength(4);
  });

  it("names a drawing beside a bare word rather than summoning another", async () => {
    const eyes = drawer();
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.draw(blob({ x: 450, y: 520 }, 30, 30));
    await player.write("a rabbit", { x: 420, y: 480 });
    expect(eyes.summoned).toEqual([]);
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual(["hopper"]);

    await player.write("summon a rabbit", { x: 420, y: 400 });
    expect(eyes.summoned).toEqual(["rabbit"]);
    expect(player.renderer.lastFrame?.inks).toHaveLength(2);
  });

  it("asks the player to draw what it has never seen, and laws still come first", async () => {
    const eyes = drawer();
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.write("draw me a unicorn", { x: 300, y: 500 });
    expect(eyes.summoned).toEqual([]);
    expect(player.sim.snapshot().drawings).toHaveLength(0);
    expect(player.written).toContain(CANNOT_DRAW_LINE("a unicorn"));
    expect(player.pondered).toEqual([]);

    await player.write("no gravity", { x: 300, y: 400 });
    expect(eyes.summoned).toEqual([]);
    expect((await player.store.load("wonderland")).rules.map((r) => r.sourceText)).toEqual([
      "no gravity",
    ]);
  });

  it("still summons the Sumikui as a law, never as a picture", async () => {
    const eyes = drawer();
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.write("summon the ink eater", { x: 300, y: 500 });
    expect(eyes.summoned).toEqual([]);
    expect(player.written).toContain(SUMIKUI_SUMMONED_LINES[0]);
  });
});

describe("Game with a Kami who takes everyone places", () => {
  const STAR: Exemplar = {
    word: "star",
    strokes: [
      [
        { x: 0, y: 100 },
        { x: 50, y: 0 },
        { x: 100, y: 100 },
      ],
    ],
  };
  const traveller = () => {
    const eyes = new Eyes([], []);
    eyes.pictures.set("star", STAR);
    eyes.pictures.set("moon", { ...STAR, word: "moon" });
    return eyes;
  };

  it("goes to a place the atlas knows without a moment's thought", async () => {
    const player = new Player("wonderland", { eyes: traveller() });
    await player.arrive();
    await player.write("teleport us to the moon", { x: 300, y: 500 });
    expect(player.travelled).toEqual([]);
    expect(player.everWritten).not.toContain(PONDERING_LINE);
  });

  it("says he is thinking while the model invents a place the atlas does not know", async () => {
    const player = new Player("wonderland", { eyes: traveller() });
    await player.arrive();
    await player.write("teleport us to the land of lost socks", { x: 300, y: 500 });
    expect(player.travelled).toEqual(["teleport us to the land of lost socks"]);
    expect(player.everWritten).toContain(PONDERING_LINE);
    expect(player.written).not.toContain(PONDERING_LINE);
  });

  it("makes the Moon: its laws at once, its props drawn in one after another, all under one note", async () => {
    const eyes = traveller();
    const player = new Player("wonderland", { eyes });
    await player.arrive();

    await player.write("teleport us to the moon", { x: 300, y: 500 });
    expect(player.travelled).toEqual([]);
    expect(player.pondered).toEqual([]);

    const rules = (await player.store.load("wonderland")).rules;
    expect(rules.map((rule) => rule.effect.governs)).toEqual(["gravity", "airDrag", "daylight"]);
    expect(player.sim.snapshot().alice).toBeDefined();
    expect(player.renderer.lastFrame?.daylight).toBe(0.3);
    expect(player.laws.laws.map((law) => law.text)).toEqual(["teleport us to the moon"]);
    expect(player.laws.laws[0]?.gloss).toMatch(/gravity/);
    expect(player.written.some((text) => text.startsWith("kami: the Moon:"))).toBe(true);
    expect(player.written).toContain("One small step. Mind the dust.");

    expect(eyes.summoned).toEqual(["moon", "star", "star", "star"]);
    await player.wait(ARRIVAL_MS * 3);
    const drawings = (await player.store.load("wonderland")).drawings;
    expect(drawings).toHaveLength(4);
    expect(player.sim.snapshot().drawings).toHaveLength(4);
    expect(drawings.every((stored) => stored.ruling !== null)).toBe(true);
    for (const { drawing } of drawings) {
      expect(
        boundsOf(drawing.strokes.flat()).y + boundsOf(drawing.strokes.flat()).height,
      ).toBeLessThan(500);
    }

    await player.erase({ x: 310, y: 515 });
    expect((await player.store.load("wonderland")).rules).toHaveLength(0);
    expect(player.laws.laws).toEqual([]);
    expect(player.renderer.lastFrame?.daylight).toBe(1);
    expect(player.sim.snapshot().drawings).toHaveLength(4);
  });

  it("keeps the scene's props scenery after a reload, so the Sumikui still spares them", async () => {
    const player = new Player("wonderland", { eyes: traveller() });
    await player.arrive();
    await player.write("teleport us to the moon", { x: 300, y: 500 });
    const { drawings } = await player.store.load("wonderland");
    expect(drawings.map(({ provenance }) => provenance)).toEqual(Array(4).fill("scenery"));
    expect(drawings.every(({ ruling }) => ruling !== null)).toBe(true);

    const reloaded = new Player("wonderland", { store: player.store });
    const added = vi.spyOn(reloaded.sim, "addDrawing");
    await reloaded.arrive();
    expect(added.mock.calls.map(([, provenance]) => provenance)).toEqual(Array(4).fill("scenery"));
  });

  it("replaces a previous scene's laws when it takes us home", async () => {
    const player = new Player("wonderland", { eyes: traveller() });
    await player.arrive();

    await player.write("teleport us to the moon", { x: 300, y: 500 });
    expect(player.laws.laws.map((law) => law.text)).toEqual(["teleport us to the moon"]);

    await player.write("take us home", { x: 300, y: 500 });

    expect(
      (await player.store.load("wonderland")).rules.every(
        (rule) => rule.sourceText === "take us home",
      ),
    ).toBe(true);
    expect(player.laws.laws).toHaveLength(1);
    expect(player.laws.laws[0]?.text).toBe("take us home");
    expect(player.renderer.lastFrame?.daylight).toBe(1);
  });

  it("replaces a scene written before a reload, not only one written this session", async () => {
    const player = new Player("wonderland", { eyes: traveller() });
    await player.arrive();
    await player.write("teleport us to the moon", { x: 300, y: 500 });
    expect(
      (await player.store.load("wonderland")).rules.every(({ scene }) => scene === "the Moon"),
    ).toBe(true);

    const reloaded = new Player("wonderland", { store: player.store, eyes: traveller() });
    await reloaded.arrive();
    await reloaded.write("take us home", { x: 300, y: 600 });

    expect(reloaded.laws.laws.map((law) => law.text)).toEqual(["take us home"]);
    expect(
      (await reloaded.store.load("wonderland")).rules.every(
        (rule) => rule.sourceText === "take us home",
      ),
    ).toBe(true);
    expect(reloaded.renderer.lastFrame?.daylight).toBe(1);
  });

  it("asks the model for a place the atlas has never heard of, and refuses none it knows", async () => {
    const eyes = traveller();
    const chocolate: Scene = {
      place: "the chocolate factory",
      laws: [{ effect: { governs: "friction", value: 0.2 }, explanation: "floors of fudge" }],
      props: [{ word: "star", at: { x: 0, y: -200 }, size: 1 }],
      line: "Mind the river.",
    };
    const player = new Player("wonderland", {
      eyes,
      farPlaces: { "take us to the chocolate factory": chocolate },
    });
    await player.arrive();

    await player.write("take us to the chocolate factory", { x: 300, y: 500 });
    expect(player.travelled).toEqual(["take us to the chocolate factory"]);
    expect(player.pondered).toEqual([]);
    expect(player.written).toContain("Mind the river.");
    expect(player.laws.laws.map((law) => law.gloss)).toEqual(["floors of fudge"]);
    expect(eyes.summoned).toEqual(["star"]);
  });

  it("says he does not know the way when nobody can make the place, after asking the thinker", async () => {
    const player = new Player("wonderland", { eyes: traveller() });
    await player.arrive();

    await player.write("take us to narnia", { x: 300, y: 500 });
    expect(await player.until(() => player.written.includes(NOWHERE_LINE("narnia")))).toBe(true);
    expect(player.travelled).toEqual(["take us to narnia"]);
    expect(player.pondered).toEqual(["take us to narnia"]);
    expect((await player.store.load("wonderland")).rules).toHaveLength(0);
  });
});
