import { describe, expect, it } from "vitest";
import type { NoteId } from "../notes/types";
import { resolvePhysics } from "../rules";
import type { Rule, RuleEffect, RuleId } from "../rules/types";
import { RuleBook } from "./ruleBook";

const law = (id: string, createdAt: number, effect: RuleEffect): Rule => ({
  id: id as RuleId,
  noteId: `note-${id}` as NoteId,
  sourceText: id,
  position: { x: 0, y: 0 },
  createdAt,
  effect,
  explanation: id,
});

const MOON = law("moon", 100, { governs: "gravity", x: 0, y: 0.165 });
const MARS = law("mars", 200, { governs: "gravity", x: 0, y: 0.38 });
const WIND = law("wind", 300, { governs: "wind", x: 0.2, y: 0 });

describe("RuleBook.place", () => {
  it("folds a law heard from elsewhere in at the moment it was written, not at the end", () => {
    const book = new RuleBook(resolvePhysics);
    book.enact(MOON);
    book.enact(WIND);
    expect(book.place(MARS)).toBe(true);
    expect(book.all.map((rule) => rule.id)).toEqual(["moon", "mars", "wind"]);
    expect(book.physics.gravity).toEqual({ x: 0, y: 0.38 });
  });

  it("changes nothing for a law it already holds word for word, and says so", () => {
    const book = new RuleBook(resolvePhysics);
    book.enact(MOON);
    expect(book.place({ ...MOON })).toBe(false);
    expect(book.all).toHaveLength(1);
  });

  it("replaces a law that was rewritten under the same id", () => {
    const book = new RuleBook(resolvePhysics);
    book.enact(MOON);
    book.enact(WIND);
    expect(book.place({ ...MOON, createdAt: 400, explanation: "later" })).toBe(true);
    expect(book.all.map((rule) => rule.id)).toEqual(["wind", "moon"]);
    expect(book.all).toHaveLength(2);
  });
});

describe("RuleBook.repeal", () => {
  it("strikes one law by id and hands it back, or null for a stranger", () => {
    const book = new RuleBook(resolvePhysics);
    book.enact(MOON);
    book.enact(MARS);
    expect(book.repeal(MARS.id)).toEqual(MARS);
    expect(book.physics.gravity).toEqual({ x: 0, y: 0.165 });
    expect(book.repeal(MARS.id)).toBeNull();
    expect(book.all).toEqual([MOON]);
  });
});
