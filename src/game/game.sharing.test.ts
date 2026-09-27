import { describe, expect, it } from "vitest";
import { type PenPoint, poseToWorld, type Vec } from "../core/geometry";
import { SANDBOX_MODE } from "../modes";
import type { Note, NoteId } from "../notes/types";
import { drawingOf } from "../sim/testSupport";
import { SharedPage } from "../sync/testing/sharedPage";
import type { PeerId } from "../sync/wire";
import { line, Player } from "./testing/player";

describe("Game on a shared page", () => {
  const ALICE = "peer-alice" as PeerId;
  const BOB = "peer-bob" as PeerId;
  const shareLinkFor = (boardId: string) => `http://kami.test/?board=${boardId}&mode=sandbox`;

  const together = async () => {
    const page = new SharedPage();
    const mine = new Player("together", {
      mode: SANDBOX_MODE,
      store: page,
      link: page.link(ALICE, 0),
      shareLinkFor,
    });
    const theirs = new Player("together", {
      mode: SANDBOX_MODE,
      store: page,
      link: page.link(BOB, 0),
      shareLinkFor,
    });
    await mine.arrive();
    await theirs.arrive();
    return { page, mine, theirs };
  };

  it("shows what another device draws, names, writes and erases, the moment it happens", async () => {
    const { mine, theirs } = await together();
    await mine.draw(line({ x: 620, y: 0 }, { x: 900, y: 0 }));
    await theirs.wait(50);
    expect(theirs.renderer.lastFrame?.inks).toHaveLength(1);
    expect(theirs.renderer.lastFrame?.inks).toHaveLength(mine.renderer.lastFrame?.inks.length ?? 0);
    await mine.write("ground", { x: 760, y: -120 });
    await theirs.wait(50);
    expect(theirs.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual(["solid"]);
    expect(theirs.written).toContain("ground");
    await mine.erase({ x: 760, y: 0 });
    await theirs.wait(50);
    expect(theirs.renderer.lastFrame?.inks).toHaveLength(0);
    expect(theirs.written).not.toContain("ground");
  });

  it("never undoes what another device made", async () => {
    const { mine, theirs } = await together();
    await theirs.draw(line({ x: 620, y: 0 }, { x: 900, y: 0 }));
    await theirs.write("it is night", { x: 200, y: -200 });
    await mine.wait(50);
    mine.game.undo();
    mine.game.undo();
    await mine.wait(50);
    await theirs.wait(50);
    expect(mine.renderer.lastFrame?.inks).toHaveLength(1);
    expect(mine.laws.laws).toHaveLength(1);
    expect(theirs.renderer.lastFrame?.inks).toHaveLength(1);
  });

  it("folds another device's laws into its own world, and refolds when they are erased", async () => {
    const { mine, theirs } = await together();
    const day = theirs.renderer.lastFrame?.daylight;
    await mine.write("it is night", { x: 200, y: -200 });
    await theirs.wait(50);
    expect(theirs.laws.laws.map((law) => law.text)).toEqual(["it is night"]);
    expect(theirs.renderer.lastFrame?.daylight).toBeLessThan(day ?? 1);
    expect(theirs.written.some((text) => text.startsWith("kami:"))).toBe(true);
    expect(mine.laws.laws).toHaveLength(1);

    await mine.erase({ x: 210, y: -185 });
    await theirs.wait(50);
    expect(theirs.laws.laws).toHaveLength(0);
    expect(theirs.renderer.lastFrame?.daylight).toBe(day);
    expect(theirs.written).not.toContain("it is night");
  });

  it("hears its own changes echoed back without doubling them", async () => {
    const { mine } = await together();
    await mine.draw(line({ x: 620, y: 0 }, { x: 900, y: 0 }));
    await mine.write("ground", { x: 760, y: -120 });
    await mine.write("it is night", { x: 200, y: -200 });
    expect(mine.renderer.lastFrame?.inks).toHaveLength(1);
    expect(mine.laws.laws).toHaveLength(1);
    expect(mine.written.filter((text) => text === "ground")).toHaveLength(1);
    expect(mine.written.filter((text) => text.startsWith("kami:"))).toHaveLength(1);
  });

  it("shows the other device's Alice as a ghost, and counts her in the share affordance", async () => {
    const { mine, theirs } = await together();
    await mine.wait(500);
    await theirs.wait(50);
    const ghosts = theirs.renderer.lastFrame?.ghosts ?? [];
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]?.center).toEqual(mine.alice.center);
    expect(theirs.hud.share).toEqual({
      boardId: "together",
      link: "http://kami.test/?board=together&mode=sandbox",
      company: 1,
    });
    expect(theirs.hud.cards).toEqual([SANDBOX_MODE.card]);
  });

  it("hands the renderer the same ghosts frame after frame until someone is heard", async () => {
    const { mine, theirs } = await together();
    await mine.wait(500);
    const company = theirs.game.company;
    await theirs.wait(50);
    expect(theirs.game.company).toBe(company);
    expect(theirs.renderer.lastFrame?.ghosts).toBe(company);
  });

  it("lets a ghost go when its device leaves the page", async () => {
    const { page, mine, theirs } = await together();
    await mine.wait(500);
    expect(theirs.game.company).toHaveLength(1);
    page.drop(ALICE);
    await theirs.wait(50);
    expect(theirs.game.company).toHaveLength(0);
    expect(theirs.hud.share?.company).toBe(0);
  });

  it("wipes its own page when another device clears the board", async () => {
    const { mine, theirs } = await together();
    await mine.draw(line({ x: 620, y: 0 }, { x: 900, y: 0 }));
    await theirs.wait(50);
    expect(theirs.renderer.lastFrame?.inks).toHaveLength(1);
    mine.game.onClearBoard();
    await theirs.wait(200);
    expect(theirs.renderer.lastFrame?.inks).toHaveLength(0);
  });

  const eraseTheInk = async (player: Player, index: number): Promise<void> => {
    const ink = player.renderer.lastFrame?.inks[index];
    const pose = player.renderer.lastFrame?.world.drawings.find((d) => d.id === ink?.drawing.id);
    const point = ink?.drawing.strokes[0]?.[4];
    if (pose === undefined || point === undefined) throw new Error("no drawing to erase");
    await player.erase(poseToWorld(point, pose.pose));
  };

  it("misses nothing another device does while the page loads, nor lets the load undo it", async () => {
    const page = new SharedPage();
    const mine = new Player("together", {
      mode: SANDBOX_MODE,
      store: page,
      link: page.link(ALICE, 0),
    });
    await mine.arrive();
    await mine.draw(line({ x: 620, y: 0 }, { x: 900, y: 0 }));
    const release = page.holdLoads();
    const theirs = new Player("together", {
      mode: SANDBOX_MODE,
      store: page,
      link: page.link(BOB, 0),
    });
    const arriving = theirs.arrive();
    await eraseTheInk(mine, 0);
    await mine.draw(line({ x: 620, y: -200 }, { x: 900, y: -200 }));
    release();
    await arriving;
    await theirs.wait(50);
    expect(theirs.renderer.lastFrame?.inks.map((ink) => ink.drawing.id)).toEqual(
      mine.renderer.lastFrame?.inks.map((ink) => ink.drawing.id),
    );
    expect(theirs.renderer.lastFrame?.inks).toHaveLength(1);
  });

  it("carries on from another device's clear without opening a new stream", async () => {
    const { page, mine, theirs } = await together();
    const streams = page.streamsOf(BOB).length;
    mine.game.onClearBoard();
    await mine.draw(line({ x: 620, y: 0 }, { x: 900, y: 0 }));
    await theirs.wait(50);
    expect(page.streamsOf(BOB)).toHaveLength(streams);
    expect(theirs.renderer.lastFrame?.inks).toHaveLength(1);
  });

  it("does not bring back what it erased when the late echo of drawing it arrives", async () => {
    const { page, mine } = await together();
    page.holdMessages();
    await mine.draw(line({ x: 620, y: 0 }, { x: 900, y: 0 }));
    await eraseTheInk(mine, 0);
    expect(mine.renderer.lastFrame?.inks).toHaveLength(0);
    page.deliver(1);
    await mine.wait(50);
    expect(mine.renderer.lastFrame?.inks).toHaveLength(0);
    page.deliver();
    await mine.wait(50);
    expect(mine.renderer.lastFrame?.inks).toHaveLength(0);
  });

  it("keeps what it drew after clearing when the late echo of the clear arrives", async () => {
    const { page, mine, theirs } = await together();
    page.holdMessages();
    mine.game.onClearBoard();
    await mine.draw(line({ x: 620, y: 0 }, { x: 900, y: 0 }));
    page.deliver(1);
    await mine.wait(50);
    expect(mine.renderer.lastFrame?.inks).toHaveLength(1);
    page.deliver();
    await mine.wait(50);
    await theirs.wait(50);
    expect(mine.renderer.lastFrame?.inks).toHaveLength(1);
    expect(theirs.renderer.lastFrame?.inks).toHaveLength(1);
  });

  const pencil = (points: readonly Vec[]): PenPoint[] =>
    points.map((point) => ({ ...point, pressure: 0.5 }));

  it("keeps a pencil's pressure on the server and on the other device", async () => {
    const { page, mine, theirs } = await together();
    await mine.draw(pencil(line({ x: 620, y: 0 }, { x: 900, y: 0 })));
    await theirs.wait(50);
    const [stored] = (await page.load("together")).drawings;
    expect(stored?.drawing.strokes[0]?.[0]?.pressure).toBe(0.5);
    expect(theirs.renderer.lastFrame?.inks[0]?.drawing.strokes[0]?.[0]?.pressure).toBe(0.5);
  });

  it("follows another device naming and erasing what it drew with a pencil", async () => {
    const { page, mine, theirs } = await together();
    await mine.draw(pencil(line({ x: 620, y: 0 }, { x: 900, y: 0 })));
    await theirs.wait(50);
    await mine.wait(50);
    await theirs.write("ground", { x: 760, y: -120 });
    await mine.wait(50);
    expect(mine.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual(["solid"]);
    await eraseTheInk(theirs, 0);
    await mine.wait(50);
    expect((await page.load("together")).drawings).toHaveLength(0);
    expect(mine.renderer.lastFrame?.inks).toHaveLength(0);
  });

  it("does not retrace its own pencil drawing when it catches up after a restart", async () => {
    const { page, mine } = await together();
    await mine.draw(pencil(line({ x: 620, y: 0 }, { x: 900, y: 0 })));
    await mine.wait(50);
    page.restart("second");
    await mine.wait(100);
    expect(mine.renderer.lastFrame?.inks).toHaveLength(1);
    expect(mine.renderer.lastFrame?.inks[0]?.settling).toBeUndefined();
  });

  it("leaves nothing behind when it clears right after drawing", async () => {
    const { page, mine, theirs } = await together();
    page.holdMessages();
    await mine.draw(line({ x: 620, y: 0 }, { x: 900, y: 0 }));
    mine.game.onClearBoard();
    page.deliver();
    await mine.wait(50);
    await theirs.wait(50);
    expect((await page.load("together")).drawings).toHaveLength(0);
    expect(mine.renderer.lastFrame?.inks).toHaveLength(0);
    expect(theirs.renderer.lastFrame?.inks).toHaveLength(0);
  });

  it("leaves nothing behind when it clears just after another device drew", async () => {
    const { page, mine, theirs } = await together();
    page.holdMessages();
    await theirs.draw(line({ x: 620, y: 0 }, { x: 900, y: 0 }));
    mine.game.onClearBoard();
    page.deliver();
    await mine.wait(50);
    await theirs.wait(50);
    expect((await page.load("together")).drawings).toHaveLength(0);
    expect(mine.renderer.lastFrame?.inks).toHaveLength(0);
    expect(theirs.renderer.lastFrame?.inks).toHaveLength(0);
  });

  it("catches up after the server restarts without starting Alice over", async () => {
    const { page, mine, theirs } = await together();
    await mine.draw(line({ x: 620, y: 0 }, { x: 900, y: 0 }));
    await theirs.wait(50);
    const [gone] = theirs.renderer.lastFrame?.inks ?? [];
    if (gone === undefined) throw new Error("the first ink never arrived");
    const spawnX = theirs.alice.center.x;
    theirs.walk(1);
    await theirs.wait(600);
    theirs.walk(0);
    await theirs.wait(300);
    const stoodAt = theirs.alice.center.x;
    expect(stoodAt - spawnX).toBeGreaterThan(20);
    page.restart("second");
    page.deleteDrawing("together", gone.drawing.id);
    page.saveDrawing("together", {
      drawing: drawingOf("after-restart", line({ x: 620, y: -300 }, { x: 900, y: -300 })),
      ruling: null,
    });
    await theirs.wait(100);
    expect(theirs.renderer.lastFrame?.inks.map((ink) => ink.drawing.id)).toEqual(["after-restart"]);
    expect(theirs.alice.center.x - spawnX).toBeGreaterThan((stoodAt - spawnX) / 2);
    await mine.draw(line({ x: 620, y: -500 }, { x: 900, y: -500 }));
    await theirs.wait(50);
    expect(theirs.renderer.lastFrame?.inks).toHaveLength(2);
  });

  const faraway = (id: string, createdAt = Date.now()): Note => ({
    id: id as NoteId,
    author: "player",
    text: "far away",
    position: { x: 6_000, y: -100 },
    tone: "plain",
    createdAt,
    fleeting: false,
  });

  const writtenAt = (player: Player, text: string): Vec | undefined => {
    const bounds = player.renderer.lastFrame?.notes.find((note) => note.script.text === text)
      ?.script.bounds;
    return bounds === undefined ? undefined : { x: bounds.x, y: bounds.y };
  };

  it("keeps another device's note where it was written, and never deletes it for its author", async () => {
    const { page, theirs } = await together();
    page.saveNote("together", faraway("n-far"));
    await theirs.wait(50);
    expect(writtenAt(theirs, "far away")?.x).toBeCloseTo(6_000, -1);
    await theirs.wait(14_000);
    expect((await page.load("together")).notes.map((note) => note.id)).toEqual(["n-far"]);
  });

  it("restores a note at its own place on a shared page, and leaves a fresh one to its writer", async () => {
    const page = new SharedPage();
    page.saveNote("together", faraway("n-far"));
    const late = new Player("together", {
      mode: SANDBOX_MODE,
      store: page,
      link: page.link(BOB, 0),
    });
    await late.arrive();
    expect(writtenAt(late, "far away")?.x).toBeCloseTo(6_000, -1);
    await late.wait(14_000);
    expect(late.written).not.toContain("far away");
    expect((await page.load("together")).notes).toHaveLength(1);
  });

  it("tidies away a note on a shared page whose writer is long gone", async () => {
    const page = new SharedPage();
    page.saveNote("together", faraway("n-old", Date.now() - 60 * 60_000));
    const late = new Player("together", {
      mode: SANDBOX_MODE,
      store: page,
      link: page.link(BOB, 0),
    });
    await late.arrive();
    await late.wait(14_000);
    expect((await page.load("together")).notes).toHaveLength(0);
  });

  it("plays alone, with no share affordance, in a room", async () => {
    const page = new SharedPage();
    const roomed = new Player("wonderland", { store: page, link: page.link(BOB), shareLinkFor });
    await roomed.arrive();
    await roomed.wait(500);
    expect(page.peersOn("wonderland")).toEqual([]);
    expect(page.presences).toEqual([]);
    expect(roomed.hud.share).toBeNull();
    expect(roomed.hud.cards).toEqual([]);
  });
});
