import { beforeEach, describe, expect, it } from "vitest";
import { boardFor } from "../../board";
import { type Rect, rectsOverlap, type Vec } from "../../core/geometry";
import { CameraRig } from "../cameraRig";
import { GameClock } from "../context";
import { IdMint } from "../idMint";
import { NOTE_FADE_MS, NOTE_STYLE, NoteBook } from "../noteBook";
import { FakeHandwriting, FakeRenderer } from "../testing/fakes";
import { HINT_LIFETIME_MS, MAX_REMARKS, Voice } from "./voice";

const ALICE: Rect = { x: 500, y: 500, width: 30, height: 60 };

describe("Voice", () => {
  let notes: NoteBook;
  let clock: GameClock;
  let announced: string[];
  let tear: Vec | null;
  let voice: Voice;

  beforeEach(() => {
    notes = new NoteBook(new FakeHandwriting());
    clock = new GameClock();
    announced = [];
    tear = null;
    voice = new Voice(
      {
        notes,
        camera: new CameraRig(),
        ids: new IdMint(),
        clock,
        board: boardFor("wonderland"),
        hud: { announce: (line) => announced.push(line), toolbarBottom: () => 64 },
        modules: { renderer: new FakeRenderer() },
      },
      { aliceBounds: () => ALICE, tearAt: () => tear },
    );
  });

  const fleeting = (): readonly string[] => notes.fleetingBy("kami").map(({ text }) => text);

  it("keeps a free remark inside the visible world", () => {
    const note = voice.write("right edge remark", { x: 1100, y: 100 }, { lifetimeMs: 6_000 });
    const { width } = new FakeRenderer().viewport();
    expect(note.position.x).toBeLessThanOrEqual(width - NOTE_STYLE.kami.maxWidth - 24);
  });

  it("reads aloud what is spoken, and not what is only decoration", () => {
    voice.write("spoken", { x: 100, y: 100 });
    voice.write("decoration", { x: 100, y: 300 }, { spoken: false });
    expect(announced).toEqual(["spoken"]);
  });

  it("never repeats a remark still on the page, and hurries the oldest past the cap", () => {
    for (const line of ["same", "same", "second", "third"]) voice.remark(line);
    expect(fleeting()).toEqual(["same", "second", "third"]);

    notes.expire(NOTE_FADE_MS);
    expect(fleeting()).toEqual(["second", "third"]);
    expect(fleeting().length).toBeLessThanOrEqual(MAX_REMARKS);
  });

  it("writes remarks clear of the tear", () => {
    tear = { x: ALICE.x - 60, y: ALICE.y - 100 };
    voice.remark("clear of the tear");
    const [note] = notes.fleetingBy("kami");
    const bounds = note === undefined ? null : notes.boundsOf(note.id);
    if (bounds === null) throw new Error("the remark was not written");
    expect(rectsOverlap(bounds, { x: tear.x - 40, y: tear.y - 120, width: 80, height: 240 })).toBe(
      false,
    );
  });

  it("recites one line after another, and drops a recital from a board since left", () => {
    voice.recite(["one", "two"], 1_000);
    voice.speakDue();
    expect(fleeting()).toEqual(["one"]);

    clock.turnPage();
    clock.nowMs = 1_000;
    voice.speakDue();
    expect(fleeting()).toEqual(["one"]);
  });

  it("hushes a recital under way", () => {
    voice.recite(["one", "two"], 1_000, 500);
    voice.hush();
    clock.nowMs = HINT_LIFETIME_MS;
    voice.speakDue();
    expect(fleeting()).toEqual([]);
  });
});
