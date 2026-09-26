import { describe, expect, it } from "vitest";
import { ForgetfulBoardStore } from "../game/forgetfulStore";
import type { Note, NoteId } from "../notes/types";
import type { PageListener } from "./boardLink";
import { EditTrackingStore } from "./editTrackingStore";
import { SharedPage } from "./testing/sharedPage";
import type { BoardChange, PeerId } from "./wire";

const BOARD = "page";

const note = (id: string, text = "hello"): Note => ({
  id: id as NoteId,
  author: "player",
  text,
  position: { x: 0, y: 0 },
  tone: "plain",
  createdAt: 1,
  fleeting: false,
});

const listening = (heard: BoardChange[]): PageListener => ({
  changed: (change) => heard.push(change),
  seen: () => {},
  resync: () => {},
});

describe("EditTrackingStore", () => {
  it("saves through to the store, and the link passes over the echo of what it saved", async () => {
    const page = new SharedPage();
    const link = page.link("peer-me" as PeerId);
    const heard: BoardChange[] = [];
    link.follow(BOARD, listening(heard), (await page.load(BOARD)).cursor ?? null);
    const store = new EditTrackingStore(page, link);
    store.saveNote(BOARD, note("mine"));
    store.deleteNote(BOARD, "mine" as NoteId);
    store.clear(BOARD);
    page.saveNote(BOARD, note("theirs"));
    expect(heard.map((change) => change.type === "put" && change.id)).toEqual(["theirs"]);
    expect((await store.load(BOARD)).notes.map(({ id }) => id)).toEqual(["theirs"]);
  });

  it("tracks nothing for a board the link does not follow, nor for a store that keeps nothing", async () => {
    const page = new SharedPage();
    const link = page.link("peer-me" as PeerId);
    const heard: BoardChange[] = [];
    link.follow(BOARD, listening(heard));
    new EditTrackingStore(page, link).saveNote("elsewhere", note("n1"));
    new EditTrackingStore(new ForgetfulBoardStore(), link).saveNote(BOARD, note("n2"));
    page.saveNote(BOARD, note("n2"));
    expect(heard.map((change) => change.type === "put" && change.id)).toEqual(["n2"]);
    expect(new EditTrackingStore(new ForgetfulBoardStore(), link).keepsBoards).toBe(false);
  });
});
