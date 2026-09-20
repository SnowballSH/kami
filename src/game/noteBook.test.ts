import { describe, expect, it } from "vitest";
import type { Note, NoteId } from "../notes/types";
import { NoteBook } from "./noteBook";
import { FakeHandwriting } from "./testing/fakes";

const note = (id: string, text: string, createdAt: number): Note => ({
  id: id as NoteId,
  author: "kami",
  text,
  position: { x: 0, y: 0 },
  tone: "plain",
  createdAt,
  fleeting: true,
});

describe("NoteBook fleeting Kami notes", () => {
  it("returns only unanchored fleeting notes in written order", () => {
    const notes = new NoteBook(new FakeHandwriting());
    notes.write({ note: note("late", "late", 2), nowMs: 20, lifetimeMs: 10 });
    notes.write({
      note: note("anchored", "anchored", 1),
      nowMs: 10,
      lifetimeMs: 10,
      anchor: { type: "note", id: "root" as NoteId },
    });
    notes.write({ note: note("early", "early", 1), nowMs: 10, lifetimeMs: 10 });

    expect(notes.fleetingBy("kami").map(({ id }) => id)).toEqual(["early", "late"]);
  });

  it("hurries a note to the fade boundary", () => {
    const book = new NoteBook(new FakeHandwriting());
    book.write({ note: note("remark", "remark", 1), nowMs: 0 });

    book.hurry("remark" as NoteId, 100);

    expect(book.views(100)[0]?.opacity).toBe(1);
    expect(book.views(800)[0]?.opacity).toBe(0);
  });

  it("settles an anchored note above an obstacle when it would cross it", () => {
    const book = new NoteBook(new FakeHandwriting());
    const written = book.write({
      note: { ...note("anchored", "anchored", 1), position: { x: 0, y: 500 } },
      nowMs: 0,
      anchor: { type: "note", id: "root" as NoteId },
      drift: "down",
      obstacles: [{ x: -20, y: 530, width: 300, height: 70 }],
      within: { x: -100, y: 0, width: 600, height: 600 },
    });

    expect(written.position.y).toBeLessThan(500);
    expect(written.position.y + 30).toBeLessThanOrEqual(530);
  });

  it("keeps notes inside the visible world, including guesses at the edge", () => {
    const book = new NoteBook(new FakeHandwriting());
    const within = { x: 0, y: 0, width: 200, height: 100 };
    const written = book.write({
      note: { ...note("edge", "a long guess", 1), position: { x: 110, y: 90 } },
      nowMs: 0,
      within,
    });
    const bounds = book.views(0)[0]?.script.bounds;
    if (bounds === undefined) throw new Error("edge note missing");
    expect(bounds.x).toBeGreaterThanOrEqual(within.x);
    expect(bounds.y).toBeGreaterThanOrEqual(within.y);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(within.x + within.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(within.y + within.height);
    expect(written.position).not.toEqual({ x: 110, y: 90 });
  });

  it("keeps a note above the ground line", () => {
    const book = new NoteBook(new FakeHandwriting());
    const written = book.write({
      note: { ...note("ground", "below ground", 1), position: { x: 10, y: 100 } },
      nowMs: 0,
      drift: "down",
      maxY: 0,
      obstacles: [{ x: -100, y: -10, width: 300, height: 10 }],
      within: { x: -100, y: -100, width: 500, height: 200 },
    });
    const bounds = book.boundsOf(written.id);
    if (bounds === null) throw new Error("ground note missing");
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(0);
  });
});
