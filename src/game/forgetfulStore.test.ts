import { describe, expect, it } from "vitest";
import type { Drawing, DrawingId } from "../ink/types";
import { ForgetfulBoardStore } from "./forgetfulStore";

describe("the forgetful board store", () => {
  it("keeps nothing it is given and has nothing to load", async () => {
    const store = new ForgetfulBoardStore();
    const drawing: Drawing = { id: "d1" as DrawingId, strokes: [[{ x: 0, y: 0 }]], cost: 0 };
    store.saveDrawing("puzzle-wall", { drawing, ruling: null });
    expect(store.hasUnsavedChanges).toBe(false);
    expect(store.state("puzzle-wall")).toEqual({
      loading: false,
      saving: false,
      unsaved: 0,
      errors: [],
    });
    expect(await store.load("puzzle-wall")).toEqual({ drawings: [], notes: [], rules: [] });
    expect(await store.listBoards()).toEqual([]);
  });
});
