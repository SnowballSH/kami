import { describe, expect, it, vi } from "vitest";
import { HttpBoardStore } from "../persistence/httpBoardStore";
import type { BoardSnapshot } from "../persistence/types";
import { ForgetfulBoardStore } from "./forgetfulStore";
import { MemoryBoardStore } from "./testing/fakes";
import { blob, Player } from "./testing/player";

describe("Game during persistence outages", () => {
  it("keeps drawing and board navigation usable after load/list failure and recovers unsaved ink", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const saved = new MemoryBoardStore();
    let offline = true;
    const store = new HttpBoardStore(async (path, init) => {
      if (offline) throw new TypeError("offline");
      if (init?.method === "PUT") return Response.json({ ok: true });
      return Response.json(
        path === "/api/boards"
          ? { boards: [{ id: "remembered", drawings: 0, rules: 0 }] }
          : await saved.load("wonderland"),
      );
    });
    try {
      const player = new Player("wonderland", { store });
      await player.arrive();
      expect(player.hud.persistence?.errors.map(({ operation }) => operation)).toEqual([
        "load",
        "list",
      ]);
      await player.draw(blob({ x: 300, y: 530 }, 30, 20));
      await store.whenIdle();
      const local = await store.load("wonderland");
      expect(local.drawings).toHaveLength(1);
      player.game.onOpenBoard("elsewhere");
      await player.wait(100);
      expect(player.hud.boards.map(({ id }) => id)).toContain("wonderland");
      player.game.onOpenBoard("wonderland");
      await player.wait(100);
      expect(player.renderer.lastFrame?.world.drawings).toHaveLength(1);
      expect(player.hud.persistence?.unsaved).toBeGreaterThan(0);

      for (const entity of local.drawings) saved.saveDrawing("wonderland", entity);
      for (const entity of local.notes) saved.saveNote("wonderland", entity);
      offline = false;
      await player.game.onRetryPersistence();
      await player.wait(100);
      expect(player.renderer.lastFrame?.world.drawings).toHaveLength(1);
      expect(player.hud.persistence).toEqual({
        loading: false,
        saving: false,
        unsaved: 0,
        errors: [],
      });
      expect(player.hud.boards.map(({ id }) => id)).toContain("remembered");
    } finally {
      warn.mockRestore();
    }
  });

  it("tells the HUD nothing is kept when the store forgets everything", async () => {
    const player = new Player("wonderland", { store: new ForgetfulBoardStore() });
    await player.arrive();
    expect(player.hud.persistence).toBeNull();
  });

  it("does not reopen a board after retry completes on a different board", async () => {
    class RetryingStore extends MemoryBoardStore {
      readonly retrying = Promise.withResolvers<void>();
      override retry(): Promise<void> {
        return this.retrying.promise;
      }
    }
    const store = new RetryingStore();
    const player = new Player("wonderland", { store });
    await player.arrive();
    const retry = player.game.onRetryPersistence();
    player.game.onOpenBoard("elsewhere");
    await player.wait(100);
    store.retrying.resolve();
    await retry;
    expect(player.renderer.board?.id).toBe("elsewhere");
  });
});

describe("Game while a board is loading", () => {
  it("pauses simulation and rejects drawing, naming, law and erase input until restore", async () => {
    const store = new MemoryBoardStore();
    const original = new Player("wonderland", { store });
    await original.arrive();
    await original.draw(blob({ x: 300, y: 530 }, 30, 20));
    await original.write("night", { x: 200, y: 200 });
    const snapshot = await store.load("wonderland");
    const pending = Promise.withResolvers<BoardSnapshot>();
    vi.spyOn(store, "load").mockReturnValueOnce(pending.promise);
    const player = new Player("wonderland", { store });
    const arrival = player.arrive();
    const prompt = vi.spyOn(player.hud, "promptText");
    await player.wait(50);
    const center = player.alice.center;
    await player.draw(blob({ x: 400, y: 530 }, 30, 20));
    player.use("write");
    player.game.tap({ x: 200, y: 200 });
    player.game.tap({ x: 300, y: 450 });
    await player.erase({ x: 300, y: 530 });
    expect(prompt).not.toHaveBeenCalled();
    expect(player.alice.center).toEqual(center);
    expect(player.written).toContain("Loading board…");
    expect(await store.load("wonderland")).toEqual(snapshot);

    pending.resolve(snapshot);
    await arrival;
    expect(player.renderer.lastFrame?.daylight).toBe(0.1);
    expect(player.renderer.lastFrame?.inks).toHaveLength(1);
    expect(player.written).not.toContain("Loading board…");
    await player.write("day", { x: 200, y: 300 });
    expect((await store.load("wonderland")).notes.some((note) => note.text === "day")).toBe(true);
  });

  it("keeps the new board locked when an older board finishes loading", async () => {
    const store = new MemoryBoardStore();
    const first = Promise.withResolvers<BoardSnapshot>();
    const second = Promise.withResolvers<BoardSnapshot>();
    vi.spyOn(store, "load").mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const player = new Player("first", { store });
    const arrival = player.arrive();
    player.game.onOpenBoard("second");
    first.resolve({ drawings: [], notes: [], rules: [] });
    await arrival;
    const prompt = vi.spyOn(player.hud, "promptText");
    player.use("write");
    player.game.tap({ x: 200, y: 200 });
    expect(prompt).not.toHaveBeenCalled();
    expect(player.written).toContain("Loading board…");
    second.resolve({ drawings: [], notes: [], rules: [] });
    await player.wait(50);
    await player.write("night", { x: 200, y: -200 });
    expect((await store.load("second")).rules).toHaveLength(1);
  });

  it("allows clearing during load and ignores the old snapshot after new edits", async () => {
    const store = new MemoryBoardStore();
    const original = new Player("wonderland", { store });
    await original.arrive();
    await original.draw(blob({ x: 300, y: 530 }, 30, 20));
    const snapshot = await store.load("wonderland");
    const pending = Promise.withResolvers<BoardSnapshot>();
    vi.spyOn(store, "load").mockReturnValueOnce(pending.promise);
    const player = new Player("wonderland", { store });
    const arrival = player.arrive();
    player.game.onClearBoard();
    await player.write("night", { x: 200, y: 200 });
    pending.resolve(snapshot);
    await arrival;
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    expect(player.renderer.lastFrame?.daylight).toBe(0.1);
    expect((await store.load("wonderland")).rules).toHaveLength(1);
  });
});
