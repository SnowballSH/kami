import { describe, expect, it } from "vitest";
import type { Note, NoteId } from "../notes/types";
import { LocalEdits } from "./localEdits";
import { type BoardChange, type BoardEdit, deletionOf } from "./wire";

const note = (text: string, x = 0): Note => ({
  id: "n1" as NoteId,
  author: "player",
  text,
  position: { x, y: 0 },
  tone: "plain",
  createdAt: 1,
  fleeting: false,
});

const put = (entity: Note): BoardEdit => ({ type: "put", kind: "notes", id: entity.id, entity });
const erase: BoardEdit = deletionOf("notes", "n1");
const CLEAR: BoardEdit = { type: "clear" };

let seq = 0;
const relayed = (edit: BoardEdit): BoardChange => {
  seq += 1;
  return { ...edit, seq } as BoardChange;
};

describe("LocalEdits", () => {
  it("admits every change about an entity this device has not written", () => {
    const edits = new LocalEdits();
    expect(edits.admits(relayed(put(note("theirs"))))).toBe(true);
    expect(edits.admits(relayed(erase))).toBe(true);
    expect(edits.pending).toBe(0);
  });

  it("passes over the echo of its own write, which is already on the board", () => {
    const edits = new LocalEdits();
    edits.wrote(put(note("mine", -0)));
    expect(edits.admits(relayed(put(note("mine", 0))))).toBe(false);
    expect(edits.pending).toBe(0);
    expect(edits.admits(relayed(put(note("theirs, later"))))).toBe(true);
  });

  it("passes over the late echo of what it has since erased, until the erase comes back", () => {
    const edits = new LocalEdits();
    edits.wrote(put(note("drawn")));
    edits.wrote(erase);
    expect(edits.admits(relayed(put(note("drawn"))))).toBe(false);
    expect(edits.admits(relayed(erase))).toBe(false);
    expect(edits.pending).toBe(0);
  });

  it("passes over older versions of what it rewrote, and another device's write that the server put first", () => {
    const edits = new LocalEdits();
    edits.wrote(put(note("first")));
    edits.wrote(put(note("second")));
    expect(edits.admits(relayed(put(note("theirs, before mine"))))).toBe(false);
    expect(edits.admits(relayed(put(note("first"))))).toBe(false);
    expect(edits.admits(relayed(put(note("second"))))).toBe(false);
    expect(edits.admits(relayed(put(note("theirs, after mine"))))).toBe(true);
  });

  it("passes over the echo of its own clear, but keeps writes made since", () => {
    const edits = new LocalEdits();
    edits.wrote(put(note("before")));
    edits.wrote(CLEAR);
    edits.wrote(put(note("after")));
    expect(edits.admits(relayed(CLEAR))).toBe(false);
    expect(edits.admits(relayed(put(note("after"))))).toBe(false);
    expect(edits.pending).toBe(0);
  });

  it("takes another device's clear, which supersedes every write of its own before it", () => {
    const edits = new LocalEdits();
    edits.wrote(put(note("mine")));
    expect(edits.admits(relayed(CLEAR))).toBe(true);
    expect(edits.pending).toBe(0);
    expect(edits.admits(relayed(put(note("mine"))))).toBe(true);
  });
});
