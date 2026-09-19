import { afterEach, describe, expect, it, vi } from "vitest";
import { DrawingIdSequence } from "./ids";
import { createInkSession } from "./index";
import type { Drawing, InkSessionListener, PlacementRules } from "./types";

const OPEN_PAGE: PlacementRules = { noInkZones: [], aliceBounds: null };
const COMMIT_AT_MS = 900;

const commitOneLine = (): Drawing | undefined => {
  const commits: Drawing[] = [];
  const listener: InkSessionListener = {
    onCommit: (drawing) => commits.push(drawing),
    onReject: () => undefined,
  };
  const session = createInkSession(listener);
  session.reset(600);
  session.penDown({ x: 0, y: 0 });
  session.penMove({ x: 50, y: 0 });
  session.penUp();
  session.update(0, OPEN_PAGE);
  session.update(COMMIT_AT_MS, OPEN_PAGE);
  return commits[0];
};

describe("drawing ids", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never repeats within a sequence", () => {
    const sequence = new DrawingIdSequence();
    const ids = Array.from({ length: 50 }, () => sequence.next());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("stay distinct across separate sessions on the same page", () => {
    const first = commitOneLine();
    const second = commitOneLine();
    expect(first?.id).toBeDefined();
    expect(first?.id).not.toBe(second?.id);
  });

  it("are minted over plain http, where the browser withholds crypto.randomUUID", () => {
    vi.stubGlobal("crypto", {});
    expect(commitOneLine()?.id).toBeDefined();
  });
});
