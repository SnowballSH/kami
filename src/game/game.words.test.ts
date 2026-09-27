import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardSnapshot } from "../persistence/types";
import type { CompiledRule } from "../rules/types";
import { HELD_INK_FADE_MS } from "./heldInk";
import { NAME_IT_FIRST_LINE } from "./kami/lines";
import { MemoryBoardStore } from "./testing/fakes";
import { blob, Eyes, line, Player, ScriptedReader, scrawl, seen } from "./testing/player";

describe("Game with a model to think with", () => {
  afterEach(() => vi.restoreAllMocks());

  const RED_PLANET = "make it feel like the red planet";
  const MARS: CompiledRule = {
    effect: { governs: "gravity", x: 0, y: 0.38 },
    explanation: "gravity = 0.38 g (Mars)",
  };

  it("orders same-millisecond laws by submission through late responses, reload and repeal", async () => {
    const pending = Promise.withResolvers<CompiledRule | null>();
    const store = new MemoryBoardStore();
    const player = new Player("wonderland", {
      store,
      thoughts: { "a custom sky": pending.promise },
    });
    await player.arrive();
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    await player.write("a custom sky", { x: 200, y: 100 });
    await player.write("night", { x: 200, y: -200 });
    expect(player.renderer.lastFrame?.daylight).toBe(0.1);
    pending.resolve({ effect: { governs: "daylight", value: 1 }, explanation: "daylight" });
    await player.wait(100);
    expect(player.renderer.lastFrame?.daylight).toBe(0.1);
    const snapshot = await store.load("wonderland");
    const ordered = snapshot.rules.toSorted((a, b) => a.createdAt - b.createdAt);
    expect(ordered.map((rule) => rule.sourceText)).toEqual(["a custom sky", "night"]);
    expect(ordered.map((rule) => rule.createdAt)).toEqual([1_000, 1_001]);
    for (const rule of ordered) {
      expect(rule.createdAt).toBe(
        snapshot.notes.find((note) => note.id === rule.noteId)?.createdAt,
      );
    }

    const reloaded = new Player("wonderland", { store });
    await reloaded.arrive();
    expect(reloaded.renderer.lastFrame?.daylight).toBe(0.1);
    const night = reloaded.renderer.lastFrame?.notes.find((note) => note.script.text === "night");
    if (night === undefined) throw new Error("night note missing");
    await reloaded.erase({ x: night.script.bounds.x + 1, y: night.script.bounds.y + 1 });
    expect(reloaded.renderer.lastFrame?.daylight).toBe(1);
    await reloaded.write("night", { x: 200, y: 300 });
    const newest = (await store.load("wonderland")).rules.find(
      (rule) => rule.sourceText === "night",
    );
    expect(newest?.createdAt).toBe(1_002);
    expect(reloaded.renderer.lastFrame?.daylight).toBe(0.1);
  });

  it("asks the model only about what nothing else understood", async () => {
    const player = new Player("wonderland", { thoughts: { [RED_PLANET]: MARS } });
    await player.arrive();

    await player.write("no friction", { x: 200, y: 100 });
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.write("a bouncy mushroom", { x: 250, y: 450 });
    expect(player.pondered).toEqual([]);

    await player.write(RED_PLANET, { x: 200, y: 200 });
    expect(player.pondered).toEqual([RED_PLANET]);
    expect(player.written).toContain("kami: gravity = 0.38 g (Mars)");
    expect(player.written).not.toContain("hmm...");
    expect((await player.store.load("wonderland")).rules.map((rule) => rule.sourceText)).toEqual([
      "no friction",
      RED_PLANET,
    ]);
  });

  it("still labels a drawing when the model has no idea either", async () => {
    const player = new Player("wonderland");
    await player.arrive();
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.write("my friend gerald", { x: 250, y: 450 });
    expect(player.pondered).toEqual(["my friend gerald"]);
    const [stored] = (await player.store.load("wonderland")).drawings;
    expect(stored?.ruling).toMatchObject({ nature: "ink" });
  });
});

describe("Game reading 'it' beside a drawing", () => {
  const SAILS = "it sails to the right";
  let player: Player;

  beforeEach(async () => {
    player = new Player("wonderland");
    await player.arrive();
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
  });

  const noteAt = (text: string) => {
    const note = player.renderer.lastFrame?.notes.find(({ script }) => script.text === text);
    if (note === undefined) throw new Error(`no note saying ${text}`);
    return note.script.bounds;
  };

  it("binds the pronoun to the named drawing, and erasing the note repeals the law", async () => {
    await player.write("a boat", { x: 250, y: 450 });
    await player.write(SAILS, { x: 180, y: 400 });

    const [law] = (await player.store.load("wonderland")).rules;
    expect(law?.effect).toEqual({
      governs: "thrust",
      of: { kind: "named", name: "boat" },
      x: 0.5,
      y: 0,
    });
    expect(player.pondered).toEqual([]);

    const { x, y } = noteAt(SAILS);
    await player.erase({ x: x + 1, y: y + 1 });
    expect((await player.store.load("wonderland")).rules).toEqual([]);
  });

  it("reads the pronoun as before when nothing is drawn nearby", async () => {
    await player.write("a boat", { x: 250, y: 450 });
    await player.write(SAILS, { x: 200, y: 100 });

    expect((await player.store.load("wonderland")).rules).toEqual([]);
    expect(player.pondered).toEqual([SAILS]);
    expect(player.ponderedBeside).toEqual([null]);
  });

  it("asks what an unnamed drawing is rather than naming it with the law", async () => {
    await player.write("it spins", { x: 250, y: 450 });

    const { drawings, rules } = await player.store.load("wonderland");
    expect(rules).toEqual([]);
    expect(drawings.map(({ ruling }) => ruling)).toEqual([null]);
    expect(player.written).toContain(NAME_IT_FIRST_LINE);
    expect(player.pondered).toEqual([]);
  });

  it("tells the model what the pronoun stands for when the grammar cannot read the law", async () => {
    await player.write("a boat", { x: 250, y: 450 });
    await player.write("it hums a sad old tune", { x: 180, y: 400 });

    expect(player.pondered).toEqual(["it hums a sad old tune"]);
    expect(player.ponderedBeside).toEqual(["boat"]);
  });
});

describe("Game with a pen that reads", () => {
  it("reads a scrawl as words while the pen is still up, and never lands it as ink", async () => {
    const reader = new ScriptedReader("no gravity");
    const player = new Player("wonderland", { reader });
    await player.arrive();

    await player.scrawl(scrawl({ x: 200, y: 200 }, 4));
    expect(reader.asked).toEqual([1, 2, 3, 4]);
    expect(player.written).toContain("no gravity");
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    const board = await player.store.load("wonderland");
    expect(board.drawings).toHaveLength(0);
    expect(board.rules.map((rule) => rule.sourceText)).toEqual(["no gravity"]);
  });

  it("holds a scrawl weightless while the reading is out, then fades it away as words", async () => {
    const reader = new ScriptedReader("slow motion", true);
    const player = new Player("wonderland", { reader });
    await player.arrive();

    await player.scrawl(scrawl({ x: 200, y: 200 }, 3));
    expect((await player.store.load("wonderland")).drawings).toHaveLength(0);
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    expect(player.renderer.lastFrame?.heldInks.map((held) => held.opacity)).toEqual([1]);
    expect(player.written).not.toContain("slow motion");

    reader.answerAll();
    await player.wait(100);
    expect(player.written).toContain("slow motion");
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    const [fading] = player.renderer.lastFrame?.heldInks ?? [];
    expect(fading?.opacity).toBeGreaterThan(0);
    expect(fading?.opacity).toBeLessThan(1);
    await player.wait(HELD_INK_FADE_MS);
    expect(player.renderer.lastFrame?.heldInks).toHaveLength(0);
    const board = await player.store.load("wonderland");
    expect(board.drawings).toHaveLength(0);
    expect(board.rules.map((rule) => rule.sourceText)).toEqual(["slow motion"]);
  });

  it("lets held ink down into the world once the reader has seen no words in it", async () => {
    const reader = new ScriptedReader(null, true);
    const player = new Player("wonderland", { reader });
    await player.arrive();

    await player.scrawl(scrawl({ x: 200, y: 200 }, 3));
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    expect(player.renderer.lastFrame?.heldInks).toHaveLength(1);

    reader.answerAll();
    await player.wait(100);
    expect(player.renderer.lastFrame?.heldInks).toHaveLength(0);
    expect(player.renderer.lastFrame?.inks).toHaveLength(1);
    expect((await player.store.load("wonderland")).drawings).toHaveLength(1);
  });

  it("does not let Kami name ink he is sure about while the reader may still call it words", async () => {
    const reader = new ScriptedReader("no gravity", true);
    const eyes = new Eyes([], [seen("snake", "slippery", true)]);
    const player = new Player("wonderland", { reader, eyes });
    await player.arrive();

    await player.scrawl(scrawl({ x: 200, y: 200 }, 3));
    expect(player.renderer.lastFrame?.heldInks).toHaveLength(1);
    expect(player.written).not.toContain("a snake");

    reader.answerAll();
    await player.wait(100);
    expect(player.written).toContain("no gravity");
    expect(player.written).not.toContain("a snake");
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
  });

  it("lets Kami name it himself once the reader has seen no words in it", async () => {
    const reader = new ScriptedReader("never said", true);
    const eyes = new Eyes([], [seen("snake", "slippery", true)]);
    const player = new Player("wonderland", { reader, eyes });
    await player.arrive();

    await player.scrawl(scrawl({ x: 200, y: 200 }, 2));
    expect(player.written).not.toContain("a snake");

    reader.answerAll();
    await player.wait(100);
    expect(player.written).toContain("a snake");
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual(["slippery"]);
  });

  it("leaves a drawing alone when the reader sees no words, and does not bother it with a line", async () => {
    const reader = new ScriptedReader("never");
    const player = new Player("wonderland", { reader });
    await player.arrive();

    await player.draw(line({ x: 370, y: 556 }, { x: 610, y: 556 }));
    expect(reader.asked).toEqual([]);
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    expect(reader.asked).toEqual([1]);
    expect((await player.store.load("wonderland")).drawings).toHaveLength(2);
    expect(player.written).not.toContain("never");
  });
});

describe("Game's CAT button", () => {
  const RUNGS = 3;

  const newLines = async (player: Player, ask: () => Promise<void>): Promise<string[]> => {
    const before = player.hud.announced.length;
    await ask();
    return player.hud.announced.slice(before);
  };

  const pressCat = (player: Player) => async (): Promise<void> => {
    player.hud.handlers.onAskForHint();
    await player.wait(100);
  };

  it("gives the hint writing *help* gives, one rung higher on each press", async () => {
    const writer = new Player("wonderland");
    const presser = new Player("wonderland");
    await writer.arrive();
    await presser.arrive();

    const written: string[][] = [];
    const pressed: string[][] = [];
    for (let rung = 0; rung < RUNGS; rung++) {
      written.push(await newLines(writer, () => writer.write("help", { x: 200, y: 200 })));
      pressed.push(await newLines(presser, pressCat(presser)));
    }

    expect(pressed).toEqual(written);
    expect(pressed.every((lines) => lines.length === 1)).toBe(true);
    expect(new Set(pressed.flat()).size).toBe(RUNGS);
    expect(presser.written).toEqual(expect.arrayContaining(pressed.flat()));
  });

  it("climbs the same ladder as writing *help*", async () => {
    const both = new Player("wonderland");
    const writer = new Player("wonderland");
    await both.arrive();
    await writer.arrive();

    const mixed = [
      ...(await newLines(both, pressCat(both))),
      ...(await newLines(both, () => both.write("help", { x: 200, y: 200 }))),
    ];
    const plain = [
      ...(await newLines(writer, () => writer.write("help", { x: 200, y: 200 }))),
      ...(await newLines(writer, () => writer.write("help", { x: 200, y: 200 }))),
    ];

    expect(mixed).toEqual(plain);
  });

  it("writes the hint above Alice, clear of the toolbar", async () => {
    const player = new Player("wonderland");
    await player.arrive();
    const [hint] = await newLines(player, pressCat(player));
    const note = player.renderer.lastFrame?.notes.find((view) => view.script.text === hint);
    const alice = player.alice;

    expect(note).toBeDefined();
    expect(note?.script.bounds.y).toBeLessThan(alice.center.y);
    expect(note?.script.bounds.y).toBeGreaterThanOrEqual(player.hud.toolbarBottomY);
  });

  it("says nothing while the board is loading", async () => {
    const store = new MemoryBoardStore();
    const pending = Promise.withResolvers<BoardSnapshot>();
    vi.spyOn(store, "load").mockReturnValueOnce(pending.promise);
    const player = new Player("wonderland", { store });
    const arrival = player.arrive();
    await player.wait(50);

    const lines = await newLines(player, pressCat(player));

    expect(lines).toEqual([]);
    pending.resolve({ drawings: [], notes: [], rules: [] });
    await arrival;
  });
});
