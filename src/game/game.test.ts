// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { poseToWorld, rectsOverlap } from "../core/geometry";
import { INPUT_LIMITS, TEXT_LIMIT_MESSAGE } from "../core/inputLimits";
import { FIXED_STEP_MS } from "../core/world";
import { EMBODIED_MODE } from "../modes";
import type { GameMode } from "../modes/types";
import type { BoardSnapshot } from "../persistence/types";
import { drawingOf } from "../sim/testSupport";
import {
  LAW_OUTSIDE_MODE_LINE,
  PERISHED_LINES,
  RULE_REPEALED_LINE,
  SUMIKUI_LORE_LINE_DELAY_MS,
  SUMIKUI_SEALED_LINE,
  SUMIKUI_SUMMONED_LINES,
  TAGLINE,
  WORDMARK,
} from "./kami/lines";
import { MAX_REMARKS } from "./kami/voice";
import { MemoryBoardStore } from "./testing/fakes";
import {
  blob,
  box,
  COMMIT_WAIT_MS,
  Eyes,
  line,
  Player,
  ScriptedReader,
  scrawl,
  seen,
} from "./testing/player";

describe("Game on the Wonderland board", () => {
  let player: Player;

  beforeEach(async () => {
    player = new Player("wonderland");
    await player.arrive();
  });

  it.each([
    { angle: Math.PI / 2, at: { x: 1000, y: 480 }, competingY: 420 },
    { angle: -Math.PI / 2, at: { x: 1000, y: 200 }, competingY: 260 },
    { angle: 0, at: { x: 1190, y: 480 }, competingY: 580 },
  ])(
    "names the nearest drawing under a full pose with angle $angle",
    async ({ angle, at, competingY }) => {
      const target = drawingOf("target", [
        { x: 300, y: 300 },
        { x: 700, y: 300 },
      ]);
      const competitor = drawingOf("competitor", [
        { x: at.x, y: competingY },
        { x: at.x + 40, y: competingY },
      ]);
      player.game.onCommit(target);
      player.game.onCommit(competitor);
      const snapshot = player.sim.snapshot();
      vi.spyOn(player.sim, "snapshot").mockReturnValue({
        ...snapshot,
        drawings: snapshot.drawings.map((drawing) => ({
          ...drawing,
          pose:
            drawing.id === target.id
              ? {
                  origin: { x: 500, y: 300 },
                  position: {
                    x: 1000,
                    y: angle === Math.PI / 2 ? 300 : angle === -Math.PI / 2 ? 400 : 480,
                  },
                  angle,
                  scale: 1,
                }
              : { origin: { x: 0, y: 0 }, position: { x: 0, y: 0 }, angle: 0, scale: 1 },
        })),
      });

      await player.write("a rock", at);

      const { drawings } = await player.store.load("wonderland");
      expect(drawings.find(({ drawing }) => drawing.id === target.id)?.ruling?.name).toBe("a rock");
      expect(drawings.find(({ drawing }) => drawing.id === competitor.id)?.ruling).toBeNull();
    },
  );

  it("opens with Kami's wordmark and the first zone's line written on the board", () => {
    expect(player.written).toContain("kami");
    expect(player.written).toContain("She can hop, not fly. You can draw.");
    expect(player.hud.boards.map((board) => board.id)).toContain("wonderland");
  });

  it("offers three tappable guesses beside a fresh drawing, and a tap names it", async () => {
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.wait(100);
    const guesses = player.renderer.lastFrame?.notes.filter((note) => note.tappable) ?? [];
    expect(guesses).toHaveLength(3);

    const [first] = guesses;
    if (first === undefined) throw new Error("no guess to tap");
    const { x, y, width, height } = first.script.bounds;
    player.game.tap({ x: x + width / 2, y: y + height / 2 });
    await player.wait(100);

    expect(player.renderer.lastFrame?.notes.filter((note) => note.tappable)).toHaveLength(0);
    const [stored] = (await player.store.load("wonderland")).drawings;
    expect(stored?.ruling?.name).toBe(first.script.text.replace(/\?$/, ""));
  });

  it("turns a written law into physics, remembers it, and repeals it when erased", async () => {
    await player.write("set g equal to the moon's gravity", { x: 200, y: 200 });
    const remembered = (await player.store.load("wonderland")).rules;
    expect(remembered).toHaveLength(1);
    expect(remembered[0]?.effect).toMatchObject({ governs: "gravity" });
    expect(player.written.some((text) => text.startsWith("kami: gravity"))).toBe(true);

    await player.erase({ x: 210, y: 215 });
    expect((await player.store.load("wonderland")).rules).toHaveLength(0);
    expect(player.written.some((text) => text.startsWith("kami: gravity"))).toBe(false);
  });

  it("rejects oversized notes before drawing or persisting them", async () => {
    const tooLong = "x".repeat(INPUT_LIMITS.text + 1);
    await player.write(tooLong, { x: 200, y: 200 });
    expect(player.written.some((text) => text.includes(tooLong))).toBe(false);
    expect(player.written.some((text) => text.includes(TEXT_LIMIT_MESSAGE))).toBe(true);
    expect((await player.store.load("wonderland")).notes).toHaveLength(0);
  });

  it("lists the standing laws in order, and a tap on one repeals it and erases its note", async () => {
    await player.write("set g equal to the moon's gravity", { x: 200, y: 200 });
    await player.write("it is night", { x: 200, y: 300 });
    expect(player.laws.laws.map((law) => law.text)).toEqual([
      "set g equal to the moon's gravity",
      "it is night",
    ]);
    expect(player.laws.laws[0]?.gloss).toMatch(/gravity/);

    const [gravity] = player.laws.laws;
    if (gravity === undefined) throw new Error("no law to repeal");
    player.laws.handlers.onRepealLaw(gravity.id);
    await player.wait(50);
    expect(player.laws.laws.map((law) => law.text)).toEqual(["it is night"]);
    expect(player.written).not.toContain("set g equal to the moon's gravity");
    expect(player.written).toContain(RULE_REPEALED_LINE);
    expect((await player.store.load("wonderland")).rules.map((rule) => rule.sourceText)).toEqual([
      "it is night",
    ]);

    const returning = new Player("wonderland", { store: player.store });
    await returning.arrive();
    expect(returning.laws.laws.map((law) => law.text)).toEqual(["it is night"]);
  });

  it("stops the lore mid-recital when the Sumikui is sealed within moments of summoning", async () => {
    await player.write("summon the ink eater", { x: 200, y: 200 });
    await player.erase({ x: 210, y: 215 });
    expect(player.written).toContain(SUMIKUI_SEALED_LINE);
    const unspoken = SUMIKUI_SUMMONED_LINES.slice(1);
    await player.wait(SUMIKUI_LORE_LINE_DELAY_MS * SUMIKUI_SUMMONED_LINES.length + 100);
    for (const line of unspoken) expect(player.written).not.toContain(line);
  });

  it("places the lore below the toolbar without overlapping the intro or earlier notes", async () => {
    player.hud.toolbarBottomY = 350;
    await player.write("summon the ink eater", { x: 200, y: 200 });
    await player.wait(SUMIKUI_LORE_LINE_DELAY_MS * 2 + 100);
    const notes = player.renderer.lastFrame?.notes ?? [];
    const lore = notes.filter((note) => SUMIKUI_SUMMONED_LINES.includes(note.script.text));
    expect(lore.length).toBeLessThanOrEqual(MAX_REMARKS);
    expect(player.written).toContain(SUMIKUI_SUMMONED_LINES[1]);
    expect(player.written).toContain(SUMIKUI_SUMMONED_LINES[2]);
    for (const note of lore) {
      expect(note.script.bounds.y).toBeGreaterThan(player.hud.toolbarBottomY);
      expect(
        notes.some(
          (other) => other.id !== note.id && rectsOverlap(note.script.bounds, other.script.bounds),
        ),
      ).toBe(false);
    }
  });

  it("summons the Sumikui with its lore, keeps it while the law stands, and seals it when erased", async () => {
    await player.write("summon the ink eater", { x: 200, y: 200 });
    expect(player.renderer.lastFrame?.world.sumikui).not.toBeNull();
    expect(player.written).toContain("kami: the Sumikui, the ink eater, is loose");
    expect(player.written).toContain(SUMIKUI_SUMMONED_LINES[0]);
    await player.wait(SUMIKUI_LORE_LINE_DELAY_MS * 2 + 100);
    expect(player.written).not.toContain(SUMIKUI_SUMMONED_LINES[0]);
    for (const line of SUMIKUI_SUMMONED_LINES.slice(1)) expect(player.written).toContain(line);

    await player.erase({ x: 210, y: 215 });
    expect(player.renderer.lastFrame?.world.sumikui).toBeNull();
    expect(player.written).toContain(SUMIKUI_SEALED_LINE);
    expect(player.written).not.toContain(RULE_REPEALED_LINE);
  });

  it("shrugs at writing that is neither a law nor near a drawing", async () => {
    await player.write("hello there", { x: 200, y: 100 });
    expect((await player.store.load("wonderland")).rules).toHaveLength(0);
    expect(player.written).toContain("hello there");
    expect(player.written.length).toBeGreaterThan(3);
  });

  it("never writes one note on top of another", async () => {
    await player.write("set g equal to the moon's gravity", { x: 200, y: 200 });
    await player.write("slow motion", { x: 200, y: 240 });
    await player.write("hello there", { x: 200, y: 280 });
    await player.write("hello again", { x: 200, y: 320 });

    const notes = player.renderer.lastFrame?.notes ?? [];
    expect(notes.length).toBeGreaterThan(6);
    const bounds = notes.map((note) => note.script.bounds);
    for (const [i, a] of bounds.entries()) {
      for (const b of bounds.slice(i + 1)) expect(rectsOverlap(a, b)).toBe(false);
    }
  });

  it("says a word over ink the heat takes, once for a whole heatwave", async () => {
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.write("an ice cube", { x: 250, y: 450 });
    await player.draw(blob({ x: 500, y: 530 }, 30, 20));
    await player.write("an icicle", { x: 450, y: 450 });
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual([
      "slippery",
      "slippery",
    ]);

    await player.write("it's 100 degrees", { x: 200, y: 200 });
    expect(await player.until(() => player.renderer.lastFrame?.inks.length === 0)).toBe(true);
    const mourned = player.everWritten.filter((text) =>
      Object.values(PERISHED_LINES).some((lines) => lines.includes(text)),
    );
    expect(new Set(mourned)).toEqual(new Set([PERISHED_LINES.slippery?.[0]]));
  });

  it("brings a board back from memory", async () => {
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.write("a rock", { x: 250, y: 450 });
    await player.write("no gravity", { x: 200, y: 200 });

    const returning = new Player("wonderland", { store: player.store });
    await returning.arrive();
    expect(returning.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual(["heavy"]);
    expect(returning.written).toContain("a rock");
    expect(returning.written).toContain("no gravity");
    expect(returning.written.some((text) => text.startsWith("kami: gravity"))).toBe(true);
  });

  it("restores legacy labels without inventing a drawing association", async () => {
    player.game.onAutopilotToggled(false);
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.write("a rock", { x: 250, y: 450 });
    const saved = await player.store.load("wonderland");
    const label = saved.notes[0];
    const drawing = saved.drawings[0]?.drawing;
    if (label === undefined || drawing === undefined) throw new Error("no named drawing");
    const { drawingId: _drawingId, ...legacy } = label;
    player.store.saveNote("wonderland", legacy);
    const returning = new Player("wonderland", { store: player.store });
    returning.game.onAutopilotToggled(false);
    await returning.arrive();
    const pose = returning.renderer.lastFrame?.world.drawings[0];
    const point = drawing.strokes[0]?.[0];
    if (pose === undefined || point === undefined) throw new Error("no drawing to erase");
    await returning.erase(poseToWorld(point, pose.pose));
    expect(returning.written).toContain("a rock");
    expect(await player.store.load("wonderland")).toEqual({
      drawings: [],
      notes: [legacy],
      rules: [],
    });
  });

  it("is completable from start to goal across Wonderland", async () => {
    await player.draw(line({ x: 370, y: 556 }, { x: 610, y: 556 }));
    await player.draw(blob({ x: 1430, y: 540 }, 30, 18));
    await player.write("a bouncy mushroom", { x: 1380, y: 440 });
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toContain("bouncy");

    player.walk(1);
    expect(await player.until(() => player.alice.center.x > 1740 && player.alice.grounded)).toBe(
      true,
    );
    expect(player.written).toContain("Curiouser and curiouser.");

    player.walk(0);
    await player.draw(blob({ x: 2150, y: 324 }, 18, 14));
    await player.write("a cake", { x: 2120, y: 250 });
    player.walk(1);
    expect(await player.until(() => player.alice.size === "big")).toBe(true);
    player.walk(-1);
    expect(await player.until(() => player.alice.hasKey)).toBe(true);

    player.walk(0);
    await player.draw(blob({ x: 2300, y: 324 }, 18, 14));
    await player.write("drink me", { x: 2270, y: 250 });
    await player.draw(blob({ x: 3490, y: 460 }, 30, 10));
    await player.write("a springy toadstool", { x: 3400, y: 400 });
    await player.draw(blob({ x: 3760, y: 324 }, 18, 14));
    await player.write("eat me", { x: 3730, y: 250 });
    player.walk(1);
    expect(await player.until(() => player.alice.size === "small")).toBe(true);
    expect(await player.until(() => player.alice.center.x > 2560)).toBe(true);
    expect(await player.until(() => player.alice.center.x > 3660 && player.alice.grounded)).toBe(
      true,
    );
    expect(await player.until(() => player.alice.size === "big")).toBe(true);
    expect(await player.until(() => player.alice.center.x > 4560 && player.alice.grounded)).toBe(
      true,
    );
    player.walk(1, -1);
    expect(await player.until(() => player.alice.center.x > 4620 && player.alice.grounded)).toBe(
      true,
    );

    player.walk(0);
    await player.draw(blob({ x: 5100, y: 194 }, 12, 15));
    await player.write("a bottle", { x: 5070, y: 120 });
    await player.draw(box({ x: 5975, y: 295 }, 130, 80));
    await player.write("an anvil", { x: 5940, y: 150 });
    player.walk(1);
    expect(await player.until(() => player.alice.size === "small")).toBe(true);
    expect(
      await player.until(() => player.written.some((text) => text.includes("rabbit hole"))),
    ).toBe(true);
    expect((await player.store.load("wonderland")).drawings.map((d) => d.ruling?.name)).toEqual([
      undefined,
      "a bouncy mushroom",
      "a springy toadstool",
      "an anvil",
    ]);
  });
});

describe.each(["live", "reloaded"])("drawing labels on a %s board", (state) => {
  const resume = async (player: Player, boardId: string): Promise<Player> => {
    if (state === "live") return player;
    const returning = new Player(boardId, { store: player.store });
    returning.game.onAutopilotToggled(false);
    await returning.arrive();
    return returning;
  };

  describe.each(["typed", "unknown", "certain", "certain ink", "guess"])("%s label", (source) => {
    it.each(["rename", "erase"])("removes the old label on %s", async (action) => {
      let player = new Player("wonderland", {
        eyes: new Eyes(
          [],
          [seen("rock", source === "certain ink" ? "ink" : "heavy", source.startsWith("certain"))],
        ),
      });
      player.game.onAutopilotToggled(false);
      await player.arrive();
      await player.draw(blob({ x: 300, y: 530 }, 30, 20));
      if (source === "guess") {
        expect((await player.store.load("wonderland")).notes).toEqual([]);
        const guess = player.renderer.lastFrame?.notes.find((note) => note.tappable);
        if (guess === undefined) throw new Error("no guess to accept");
        const { x, y } = guess.script.bounds;
        player.game.tap({ x, y });
        await player.wait(100);
      } else if (!source.startsWith("certain")) {
        await player.write(source === "unknown" ? "my friend gerald" : "a rock", {
          x: 250,
          y: 450,
        });
      }
      const saved = await player.store.load("wonderland");
      expect(saved.notes).toHaveLength(1);
      const label = saved.notes[0];
      const drawing = saved.drawings[0]?.drawing;
      if (label === undefined || drawing === undefined) throw new Error("no named drawing");
      expect(label.drawingId).toBe(drawing.id);
      expect(label.fleeting).toBe(false);
      expect(label.action).toBeUndefined();

      player = await resume(player, "wonderland");
      expect(player.written).toContain(label.text);
      if (action === "rename") await player.write("a cloud", { x: 250, y: 400 });
      else {
        const pose = player.renderer.lastFrame?.world.drawings.find((d) => d.id === drawing.id);
        const point = drawing.strokes[0]?.[0];
        if (pose === undefined || point === undefined) throw new Error("no drawing to erase");
        await player.erase(poseToWorld(point, pose.pose));
      }
      expect(player.written).not.toContain(label.text);
      const remaining = await player.store.load("wonderland");
      expect(remaining.notes.map((note) => note.text)).toEqual(
        action === "rename" ? ["a cloud"] : [],
      );
      if (action === "rename") expect(remaining.notes[0]?.drawingId).toBe(drawing.id);
      const returning = new Player("wonderland", { store: player.store });
      await returning.arrive();
      expect(returning.written).not.toContain(label.text);
    });
  });

  it("removes a consumed cake's label from the board and memory", async () => {
    let player = new Player("wonderland");
    player.game.onAutopilotToggled(false);
    await player.arrive();
    await player.draw(blob({ x: 260, y: 540 }, 18, 14));
    await player.write("a cake", { x: 230, y: 450 });
    player = await resume(player, "wonderland");
    expect(player.written).toContain("a cake");
    player.walk(1);
    expect(await player.until(() => player.alice.size === "big")).toBe(true);
    expect(player.written).not.toContain("a cake");
    expect(await player.store.load("wonderland")).toEqual({ drawings: [], notes: [], rules: [] });
    const returning = new Player("wonderland", { store: player.store });
    await returning.arrive();
    expect(returning.written).not.toContain("a cake");
  });

  it("removes a devoured drawing's label while retaining the ink-eater law", async () => {
    const boardId = "hungry-board";
    let player = new Player(boardId);
    player.game.onAutopilotToggled(false);
    await player.arrive();
    await player.draw(blob({ x: 60, y: -5 }, 24, 24));
    await player.write("a rock", { x: 40, y: -100 });
    const rock = (await player.store.load(boardId)).drawings[0]?.drawing;
    if (rock === undefined) throw new Error("no rock");
    await player.draw(blob({ x: 240, y: -5 }, 24, 24));
    await player.write("summon the ink eater", { x: 800, y: -300 });
    player = await resume(player, boardId);
    expect(player.written).toContain("a rock");
    player.walk(1);
    await player.wait(750);
    player.walk(0);
    expect(
      await player.until(
        () => !player.renderer.lastFrame?.world.drawings.some((d) => d.id === rock.id),
      ),
    ).toBe(true);
    expect(player.written).not.toContain("a rock");
    const saved = await player.store.load(boardId);
    expect(saved.drawings).toHaveLength(0);
    expect(saved.notes.map((note) => note.text)).toEqual([]);
    expect(saved.rules).toHaveLength(1);
    const returning = new Player(boardId, { store: player.store });
    await returning.arrive();
    expect(returning.written).not.toContain("a rock");
    expect(returning.laws.laws.map((law) => law.text)).toEqual(["summon the ink eater"]);
  });
});

describe("Alice on her own", () => {
  let player: Player;

  beforeEach(async () => {
    player = new Player("wonderland");
    await player.arrive();
  });

  it("walks to the ditch, stops short of it, and says so", async () => {
    expect(await player.until(() => player.alice.center.x > 150)).toBe(true);
    expect(
      await player.until(() => player.written.some((text) => text.includes("Draw her one"))),
    ).toBe(true);
    await player.wait(3_000);
    expect(player.alice.center.x).toBeGreaterThan(150);
    expect(player.alice.center.x).toBeLessThan(380);
    expect(player.alice.grounded).toBe(true);
  });

  it("crosses all of Wonderland with nothing but drawings", async () => {
    await player.draw(line({ x: 370, y: 556 }, { x: 610, y: 556 }));
    expect(await player.until(() => player.alice.center.x > 700)).toBe(true);

    await player.draw(blob({ x: 1430, y: 540 }, 30, 18));
    await player.write("a bouncy mushroom", { x: 1380, y: 440 });
    expect(await player.until(() => player.alice.center.x > 1740 && player.alice.grounded)).toBe(
      true,
    );

    await player.draw(blob({ x: 2150, y: 324 }, 18, 14));
    await player.write("a cake", { x: 2120, y: 250 });
    expect(await player.until(() => player.alice.size === "big")).toBe(true);
    expect(await player.until(() => player.alice.hasKey)).toBe(true);

    await player.draw(blob({ x: 2300, y: 324 }, 18, 14));
    await player.write("drink me", { x: 2270, y: 250 });
    await player.draw(blob({ x: 3490, y: 460 }, 30, 10));
    await player.write("a springy toadstool", { x: 3400, y: 400 });
    await player.draw(blob({ x: 3760, y: 324 }, 18, 14));
    await player.write("eat me", { x: 3730, y: 250 });
    await player.draw(blob({ x: 5100, y: 194 }, 12, 15));
    await player.write("a bottle", { x: 5070, y: 120 });
    await player.draw(box({ x: 5975, y: 295 }, 130, 80));
    await player.write("an anvil", { x: 5940, y: 150 });

    expect(await player.until(() => player.alice.center.x > 2560)).toBe(true);
    expect(await player.until(() => player.alice.center.x > 3660 && player.alice.grounded)).toBe(
      true,
    );
    expect(await player.until(() => player.alice.center.x > 4620 && player.alice.grounded)).toBe(
      true,
    );
    expect(await player.until(() => player.alice.size === "small")).toBe(true);
    expect(
      await player.until(() => player.written.some((text) => text.includes("rabbit hole"))),
    ).toBe(true);
  });

  it("hops over a fire drawn across her path", async () => {
    await player.draw(blob({ x: 260, y: 550 }, 10, 10));
    await player.write("fire", { x: 230, y: 480 });
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toContain("hazard");

    expect(await player.until(() => !player.alice.grounded && player.alice.center.x > 200)).toBe(
      true,
    );
    expect(await player.until(() => player.alice.center.x > 300 && player.alice.grounded)).toBe(
      true,
    );
  });

  it("stays put when the player switches her self-walking off, and sets off again when it is back on", async () => {
    const player = new Player("wonderland");
    await player.arrive();
    expect(player.hud.autopilotOffered).toBe(true);
    player.game.onAutopilotToggled(false);
    expect(player.hud.autopilot).toBe(false);
    const parked = player.alice.center.x;
    await player.wait(1_500);
    expect(player.alice.center.x).toBeCloseTo(parked, 0);

    player.game.onAutopilotToggled(true);
    expect(await player.until(() => player.alice.center.x > parked + 60, 6_000)).toBe(true);
  });

  it("yields to the keyboard while a key is held", async () => {
    player.walk(-1);
    await player.wait(1_000);
    expect(player.alice.center.x).toBeLessThan(100);
    player.walk(0);
    expect(await player.until(() => player.alice.center.x > 150)).toBe(true);
  });
});

describe("Game under a mode", () => {
  it("suspends forbidden saved laws without deleting them, and erasing their note still repeals them", async () => {
    const original = new Player("wonderland");
    await original.arrive();
    await original.write("it is night", { x: 200, y: 200 });
    await original.write("no gravity", { x: 200, y: 300 });
    const saved = await original.store.load("wonderland");
    const mode: GameMode = { ...EMBODIED_MODE, laws: { kind: "except", dials: ["daylight"] } };
    const restricted = new Player("wonderland", { store: original.store, mode });
    await restricted.arrive();

    expect(restricted.renderer.lastFrame?.daylight).toBe(1);
    expect(restricted.laws.laws.map((law) => law.text)).toEqual(["no gravity"]);
    expect(restricted.written).toContain(LAW_OUTSIDE_MODE_LINE);
    const note = restricted.renderer.lastFrame?.notes.find(
      (entry) => entry.script.text === "it is night",
    );
    expect(note?.tone).toBe("plain");
    expect(await original.store.load("wonderland")).toEqual(saved);

    const unrestricted = new Player("wonderland", { store: original.store });
    await unrestricted.arrive();
    expect(unrestricted.renderer.lastFrame?.daylight).toBe(original.renderer.lastFrame?.daylight);
    expect(unrestricted.renderer.lastFrame?.daylight).toBeLessThan(1);
    expect(unrestricted.laws.laws).toHaveLength(2);

    if (note === undefined) throw new Error("night note missing");
    const { x, y } = note.script.bounds;
    await restricted.erase({ x: x + 1, y: y + 1 });
    expect((await original.store.load("wonderland")).rules.map((rule) => rule.sourceText)).toEqual([
      "no gravity",
    ]);
    const reopened = new Player("wonderland", { store: original.store });
    await reopened.arrive();
    expect(reopened.renderer.lastFrame?.daylight).toBe(1);
  });

  it("also refuses forbidden model-compiled laws", async () => {
    const text = "make this page Martian";
    const mode: GameMode = { ...EMBODIED_MODE, laws: { kind: "only", dials: ["daylight"] } };
    const player = new Player("wonderland", {
      mode,
      thoughts: {
        [text]: {
          effect: { governs: "gravity", x: 0, y: 0.38 },
          explanation: "gravity = 0.38 g",
        },
      },
    });
    await player.arrive();
    await player.write(text, { x: 200, y: 200 });
    expect(player.pondered).toContain(text);
    expect(player.laws.laws).toHaveLength(0);
    expect((await player.store.load("wonderland")).rules).toHaveLength(0);
    expect(player.written).toContain(LAW_OUTSIDE_MODE_LINE);
  });

  it("refuses a law the mode forbids, in Kami's hand, and the note stays plain writing", async () => {
    const mode: GameMode = { ...EMBODIED_MODE, laws: { kind: "except", dials: ["gravity"] } };
    const player = new Player("wonderland", { mode });
    await player.arrive();
    await player.write("set g equal to the moon's gravity", { x: 200, y: 200 });
    expect((await player.store.load("wonderland")).rules).toHaveLength(0);
    expect(player.written).toContain(LAW_OUTSIDE_MODE_LINE);

    await player.write("it is night", { x: 200, y: 300 });
    expect((await player.store.load("wonderland")).rules).toHaveLength(1);
  });

  it("keeps Alice from walking herself when the mode forbids it", async () => {
    const player = new Player("wonderland", { mode: { ...EMBODIED_MODE, autopilot: "forbidden" } });
    await player.arrive();
    expect(player.hud.autopilotOffered).toBe(false);
    const parked = player.alice.center.x;
    player.game.onAutopilotToggled(true);
    expect(player.hud.autopilot).toBe(false);
    await player.wait(1_500);
    expect(player.alice.center.x).toBeCloseTo(parked, 0);
  });
});

describe("Game's voice for screen readers", () => {
  it("reads out what Kami says, but not his wordmark or a board loading", async () => {
    const player = new Player("wonderland");
    await player.arrive();
    await player.write("it is night", { x: 200, y: 200 });
    const { announced } = player.hud;
    expect(announced).not.toContain(WORDMARK);
    expect(announced).not.toContain(TAGLINE);
    expect(announced).not.toContain("Loading board…");
    expect(announced.some((line) => line.startsWith("kami:"))).toBe(true);
    await player.erase({ x: 210, y: 215 });
    expect(announced).toContain(RULE_REPEALED_LINE);
  });
});

describe("Game under reduced motion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const anglesWhileSpinning = async (): Promise<readonly number[]> => {
    const player = new Player("wonderland");
    await player.arrive();
    await player.write("the world spins slowly", { x: 200, y: 200 });
    const angles: number[] = [];
    for (let frame = 0; frame < 240; frame++) {
      await player.wait(FIXED_STEP_MS);
      angles.push(player.renderer.lastFrame?.camera.angle ?? 0);
    }
    return angles;
  };

  const turnsBetweenFrames = (angles: readonly number[]): readonly number[] =>
    angles.flatMap((angle, frame) => {
      const before = angles[frame - 1];
      return before === undefined || before === angle ? [] : [Math.abs(angle - before)];
    });

  it("turns the camera with the spinning page every frame", async () => {
    const turns = turnsBetweenFrames(await anglesWhileSpinning());
    expect(turns.length).toBeGreaterThan(100);
    expect(Math.max(...turns)).toBeLessThan(1);
  });

  it("turns the camera in steps of 15° or more when the player asks for less motion", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    const turns = turnsBetweenFrames(await anglesWhileSpinning());
    expect(turns.length).toBeGreaterThan(0);
    for (const turn of turns) expect(turn).toBeGreaterThanOrEqual(15);
  });
});

describe("Game on a blank board", () => {
  it("makes a new game out of sketches and notes", async () => {
    const player = new Player("my-first-game");
    await player.arrive();

    await player.draw(line({ x: 200, y: -40 }, { x: 700, y: -40 }));
    await player.write("platform", { x: 400, y: -130 });
    await player.draw(blob({ x: 650, y: -80 }, 16, 16));
    await player.write("goal", { x: 640, y: -170 });
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual(["solid", "goal"]);

    player.walk(1);
    expect(
      await player.until(() => player.written.some((text) => text.includes("rabbit hole"))),
    ).toBe(true);
  });

  it("gives the controls back to Alice herself when the law that made the chosen twin is erased", async () => {
    const player = new Player("my-first-game");
    await player.arrive();
    await player.write("clone alice", { x: -200, y: -200 });
    const twin = () => player.renderer.lastFrame?.world.twins[0];
    expect(await player.until(() => twin() !== undefined)).toBe(true);
    const tapped = twin();
    if (tapped === undefined) throw new Error("no twin to tap");
    player.use("draw");
    player.game.tap(tapped.center);
    await player.wait(100);
    expect(player.renderer.lastFrame?.selectedAlice).toBe(1);

    await player.erase({ x: -190, y: -185 });
    await player.wait(100);
    expect(player.renderer.lastFrame?.world.twins).toEqual([]);
    expect(player.renderer.lastFrame?.selectedAlice).toBe(0);
    expect(player.written).toContain(RULE_REPEALED_LINE);
  });

  it("hands the controls to a tapped twin, and says which Alice found the rabbit hole", async () => {
    const player = new Player("my-first-game");
    await player.arrive();
    await player.write("clone alice", { x: -200, y: -200 });
    const twin = () => player.renderer.lastFrame?.world.twins[0];
    expect(await player.until(() => twin() !== undefined)).toBe(true);
    const tapped = twin();
    if (tapped === undefined) throw new Error("no twin to tap");
    expect(player.renderer.lastFrame?.selectedAlice).toBe(0);

    player.use("draw");
    player.game.tap(tapped.center);
    await player.wait(100);
    expect(player.renderer.lastFrame?.selectedAlice).toBe(1);
    expect(player.written).toContain("Alice 2, then. Lead on.");

    player.game.onAutopilotToggled(false);
    await player.draw(blob({ x: 250, y: -20 }, 16, 16));
    await player.write("goal", { x: 240, y: -110 });
    const herself = player.alice.center.x;
    player.walk(1);
    const found = () => player.written.filter((text) => text.includes("found the rabbit hole"));
    expect(await player.until(() => found().length > 0)).toBe(true);
    expect(found()).toEqual(["Alice 2 found the rabbit hole. One of you was enough."]);
    expect(player.alice.center.x).toBeCloseTo(herself, 0);
    expect(player.renderer.lastFrame?.selectedAlice).toBe(1);
  });
});

describe("Game's undo", () => {
  it("takes back the player's own law, then drawing, and refunds the ink", async () => {
    const player = new Player("wonderland");
    await player.arrive();
    const refund = vi.spyOn(player.ink, "refund");
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.write("it is night", { x: 200, y: 200 });
    const [drawn] = (await player.store.load("wonderland")).drawings;
    expect(player.laws.laws).toHaveLength(1);
    expect(player.renderer.lastFrame?.daylight).toBeLessThan(1);

    player.game.onUndo();
    await player.wait(50);
    expect(player.laws.laws).toHaveLength(0);
    expect(player.renderer.lastFrame?.daylight).toBe(1);
    expect(player.written).not.toContain("it is night");
    expect((await player.store.load("wonderland")).rules).toHaveLength(0);
    expect(player.renderer.lastFrame?.inks).toHaveLength(1);

    player.game.undo();
    await player.wait(50);
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    expect((await player.store.load("wonderland")).drawings).toHaveLength(0);
    expect(refund).toHaveBeenCalledWith(drawn?.drawing.cost);
    expect(drawn?.drawing.cost).toBeGreaterThan(0);

    player.game.undo();
    await player.wait(50);
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
  });

  it("takes back ink still under the pen before anything already on the page", async () => {
    const player = new Player("wonderland");
    await player.arrive();
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    const landed = (await player.store.load("wonderland")).drawings.map(
      ({ drawing }) => drawing.id,
    );
    player.game.penDown({ x: 500, y: 400 });
    player.game.penMove({ x: 600, y: 400 });
    player.game.penUp();
    player.game.undo();
    await player.wait(COMMIT_WAIT_MS);
    const kept = (await player.store.load("wonderland")).drawings.map(({ drawing }) => drawing.id);
    expect(kept).toEqual(landed);
    expect(landed).toHaveLength(1);
  });

  it("skips what was already erased and forgets everything when another board opens", async () => {
    const player = new Player("wonderland");
    await player.arrive();
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    await player.write("it is night", { x: 200, y: 200 });
    await player.erase({ x: 210, y: 215 });
    player.game.undo();
    await player.wait(50);
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);

    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    player.game.onOpenBoard("elsewhere");
    await player.wait(50);
    player.game.onOpenBoard("wonderland");
    await player.wait(50);
    player.game.undo();
    await player.wait(50);
    expect(player.renderer.lastFrame?.inks).toHaveLength(1);
  });

  it("takes back ink still being read before the drawing under it, and its reading comes to nothing", async () => {
    const reader = new ScriptedReader(null, true);
    const player = new Player("wonderland", { reader });
    await player.arrive();
    const refund = vi.spyOn(player.ink, "refund");
    await player.draw(blob({ x: 300, y: 530 }, 30, 20));
    reader.answerAll();
    await player.wait(100);
    const landed = (await player.store.load("wonderland")).drawings.map(
      ({ drawing }) => drawing.id,
    );
    expect(landed).toHaveLength(1);

    await player.scrawl(scrawl({ x: 200, y: 200 }, 3));
    expect(player.renderer.lastFrame?.heldInks).toHaveLength(1);
    player.game.undo();
    await player.wait(50);
    expect(player.renderer.lastFrame?.heldInks).toHaveLength(0);
    expect(refund).toHaveBeenCalledTimes(1);

    reader.answerAll();
    await player.wait(100);
    const kept = (await player.store.load("wonderland")).drawings.map(({ drawing }) => drawing.id);
    expect(kept).toEqual(landed);
    expect(player.renderer.lastFrame?.inks).toHaveLength(1);

    player.game.undo();
    await player.wait(50);
    expect((await player.store.load("wonderland")).drawings).toHaveLength(0);
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
  });

  it("takes back a drawing that landed after ink still being read before that ink", async () => {
    const reader = new ScriptedReader("slow motion", true);
    const player = new Player("wonderland", { reader });
    await player.arrive();
    await player.scrawl(scrawl({ x: 200, y: 200 }, 3));
    await player.draw(line({ x: 250, y: 500 }, { x: 450, y: 500 }));
    expect(player.renderer.lastFrame?.heldInks).toHaveLength(1);
    expect((await player.store.load("wonderland")).drawings).toHaveLength(1);

    player.game.undo();
    await player.wait(50);
    expect((await player.store.load("wonderland")).drawings).toHaveLength(0);
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    expect(player.renderer.lastFrame?.heldInks).toHaveLength(1);

    player.game.undo();
    await player.wait(50);
    expect(player.renderer.lastFrame?.heldInks).toHaveLength(0);
    reader.answerAll();
    await player.wait(100);
    expect(player.written).not.toContain("slow motion");
  });

  it("is ignored while the board loads", async () => {
    const store = new MemoryBoardStore();
    const pending = Promise.withResolvers<BoardSnapshot>();
    vi.spyOn(store, "load").mockReturnValueOnce(pending.promise);
    const player = new Player("wonderland", { store });
    const arrival = player.arrive();
    const retract = vi.spyOn(player.ink, "retract");
    player.game.undo();
    expect(retract).not.toHaveBeenCalled();
    pending.resolve({ drawings: [], notes: [], rules: [] });
    await arrival;
  });
});
