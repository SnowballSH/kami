import { describe, expect, it } from "vitest";
import type { DrawingId } from "../ink/types";
import type { NoteId } from "../notes/types";
import { HANDIWORK_DEPTH, Handiwork, type Made } from "./handiwork";

const drawing = (id: string, cost = 10): Made => ({ kind: "drawing", id: id as DrawingId, cost });
const note = (id: string): Made => ({ kind: "note", id: id as NoteId });

describe("Handiwork", () => {
  it("gives back the newest thing made first", () => {
    const work = new Handiwork();
    work.record(drawing("a"));
    work.record(note("b"));
    expect(work.takeLatest(() => true)).toEqual(note("b"));
    expect(work.takeLatest(() => true)).toEqual(drawing("a"));
    expect(work.takeLatest(() => true)).toBeNull();
  });

  it("passes over and forgets what is already gone", () => {
    const work = new Handiwork();
    work.record(drawing("kept"));
    work.record(drawing("eaten"));
    expect(work.takeLatest((made) => made.id !== "eaten")).toEqual(drawing("kept"));
    expect(work.takeLatest(() => true)).toBeNull();
  });

  it("knows what a drawing of its own cost, and nothing of anyone else's", () => {
    const work = new Handiwork();
    work.record(drawing("mine", 42));
    expect(work.costOf("mine" as DrawingId)).toBe(42);
    expect(work.costOf("theirs" as DrawingId)).toBe(0);
  });

  it("keeps only the most recent handiwork, and nothing once cleared", () => {
    const work = new Handiwork();
    for (let index = 0; index <= HANDIWORK_DEPTH; index++) work.record(drawing(`d${index}`));
    let taken = 0;
    while (work.takeLatest(() => true) !== null) taken++;
    expect(taken).toBe(HANDIWORK_DEPTH);
    work.record(note("n"));
    work.clear();
    expect(work.takeLatest(() => true)).toBeNull();
  });
});
