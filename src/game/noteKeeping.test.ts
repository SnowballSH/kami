import { describe, expect, it } from "vitest";
import type { Note, NoteId } from "../notes/types";
import { NoteKeeping } from "./noteKeeping";

const note = (id: string, author: Note["author"]): Note => ({
  id: id as NoteId,
  author,
  text: id,
  position: { x: 0, y: 0 },
  tone: "plain",
  createdAt: 0,
  fleeting: false,
});

describe("NoteKeeping", () => {
  it("keeps the player's words and Kami's labels, and nothing else of his", () => {
    const keeping = new NoteKeeping(() => undefined);
    keeping.keepLabel("label" as NoteId);
    expect(keeping.isStored(note("words", "player"))).toBe(true);
    expect(keeping.isStored(note("label", "kami"))).toBe(true);
    expect(keeping.isStored(note("remark", "kami"))).toBe(false);
  });

  it("deletes a faded note only when this device answers for it", () => {
    const deleted: NoteId[] = [];
    const keeping = new NoteKeeping((id) => deleted.push(id));
    keeping.answerFor("mine" as NoteId);
    keeping.placed(note("theirs", "player"), false);
    keeping.letGo([note("mine", "player"), note("theirs", "player")]);
    expect(deleted).toEqual(["mine"]);
  });

  it("stops keeping a label another device took off the page", () => {
    const deleted: NoteId[] = [];
    const keeping = new NoteKeeping((id) => deleted.push(id));
    const label = note("label", "kami");
    keeping.placed(label, false);
    keeping.dropped([label]);
    keeping.forget([label]);
    expect(deleted).toEqual([]);
  });
});
