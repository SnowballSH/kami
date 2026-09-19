import { beforeEach, describe, expect, it } from "vitest";
import type { Rect, Vec } from "../core/geometry";
import { createInkSession } from "./index";
import type {
  Drawing,
  InkSession,
  InkSessionListener,
  PlacementRejection,
  PlacementRules,
} from "./types";

const OPEN_PAGE: PlacementRules = { noInkZones: [], aliceBounds: null };
const ALICE: Rect = { x: 100, y: 500, width: 28, height: 60 };

class RecordingListener implements InkSessionListener {
  readonly commits: Drawing[] = [];
  readonly rejections: PlacementRejection[] = [];

  onCommit(drawing: Drawing): void {
    this.commits.push(drawing);
  }

  onReject(reason: PlacementRejection): void {
    this.rejections.push(reason);
  }
}

const drawLine = (session: InkSession, from: Vec, to: Vec): void => {
  session.penDown(from);
  session.penMove(to);
  session.penUp();
};

describe("PenInkSession", () => {
  let listener: RecordingListener;
  let session: InkSession;

  beforeEach(() => {
    listener = new RecordingListener();
    session = createInkSession(listener);
    session.reset(600);
  });

  it("joins strokes drawn inside the commit window into one drawing", () => {
    drawLine(session, { x: 0, y: 0 }, { x: 100, y: 0 });
    session.update(1000, OPEN_PAGE);
    session.update(1800, OPEN_PAGE);
    drawLine(session, { x: 0, y: 50 }, { x: 0, y: 150 });
    session.update(1900, OPEN_PAGE);
    session.update(2700, OPEN_PAGE);
    expect(listener.commits).toHaveLength(0);
    expect(session.isDrawing).toBe(true);

    session.update(2800, OPEN_PAGE);
    expect(listener.commits).toHaveLength(1);
    expect(listener.commits[0]?.strokes).toHaveLength(2);
    expect(listener.commits[0]?.cost).toBeCloseTo(200);
    expect(session.isDrawing).toBe(false);
    expect(session.activeStrokes).toHaveLength(0);
  });

  it("commits separate drawings with distinct ids", () => {
    drawLine(session, { x: 0, y: 0 }, { x: 50, y: 0 });
    session.update(0, OPEN_PAGE);
    session.update(900, OPEN_PAGE);
    drawLine(session, { x: 0, y: 40 }, { x: 50, y: 40 });
    session.update(1000, OPEN_PAGE);
    session.update(1900, OPEN_PAGE);
    const ids = listener.commits.map((drawing) => drawing.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("advances the commit timer only through update(nowMs)", () => {
    drawLine(session, { x: 0, y: 0 }, { x: 100, y: 0 });
    expect(listener.commits).toHaveLength(0);
    session.update(5_000_000, OPEN_PAGE);
    expect(listener.commits).toHaveLength(0);
    session.update(5_000_899, OPEN_PAGE);
    expect(listener.commits).toHaveLength(0);
    session.update(5_000_900, OPEN_PAGE);
    expect(listener.commits).toHaveLength(1);
  });

  it("holds the commit while the pen is still down", () => {
    session.penDown({ x: 0, y: 0 });
    session.penMove({ x: 100, y: 0 });
    session.update(0, OPEN_PAGE);
    session.update(10_000, OPEN_PAGE);
    expect(listener.commits).toHaveLength(0);
    expect(session.isDrawing).toBe(true);
  });

  it("drains the budget live and runs dry at zero", () => {
    session.reset(100);
    session.penDown({ x: 0, y: 0 });
    session.penMove({ x: 60, y: 0 });
    expect(session.budget).toEqual({ total: 100, remaining: 40 });

    session.penMove({ x: 200, y: 0 });
    expect(session.budget.remaining).toBe(0);
    session.penMove({ x: 200, y: 300 });
    session.penUp();
    session.penDown({ x: 0, y: 50 });
    session.penMove({ x: 80, y: 50 });
    session.penUp();

    session.update(0, OPEN_PAGE);
    session.update(900, OPEN_PAGE);
    expect(listener.commits).toHaveLength(1);
    expect(listener.commits[0]?.strokes).toHaveLength(1);
    expect(listener.commits[0]?.cost).toBeCloseTo(100);
    expect(listener.commits[0]?.strokes[0]?.at(-1)?.x).toBeCloseTo(100);
    expect(session.budget.remaining).toBe(0);
  });

  it("drops points closer than the minimum spacing", () => {
    session.penDown({ x: 0, y: 0 });
    session.penMove({ x: 2, y: 0 });
    session.penMove({ x: 2.5, y: 1 });
    session.penMove({ x: 10, y: 0 });
    expect(session.activeStrokes[0]).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it("rejects ink over Alice, refunds it and tells the listener", () => {
    drawLine(session, { x: 50, y: 530 }, { x: 200, y: 530 });
    const rules: PlacementRules = { noInkZones: [], aliceBounds: ALICE };
    session.update(0, rules);
    expect(session.activeVerdict).toBe("overlaps-alice");
    expect(session.budget.remaining).toBe(450);

    session.update(900, rules);
    expect(listener.rejections).toEqual(["overlaps-alice"]);
    expect(listener.commits).toHaveLength(0);
    expect(session.budget.remaining).toBe(600);
    expect(session.activeVerdict).toBe("ok");
    expect(session.isDrawing).toBe(false);
  });

  it("rejects ink on painted paper", () => {
    drawLine(session, { x: 0, y: 0 }, { x: 100, y: 0 });
    const rules: PlacementRules = {
      noInkZones: [{ x: 90, y: -10, width: 50, height: 50 }],
      aliceBounds: null,
    };
    session.update(0, rules);
    session.update(900, rules);
    expect(listener.rejections).toEqual(["no-ink-zone"]);
  });

  it("drops stray taps silently", () => {
    drawLine(session, { x: 10, y: 10 }, { x: 14, y: 10 });
    session.update(0, OPEN_PAGE);
    session.update(900, OPEN_PAGE);
    expect(listener.commits).toHaveLength(0);
    expect(listener.rejections).toHaveLength(0);
    expect(session.isDrawing).toBe(false);
    expect(session.budget.remaining).toBe(600);
  });

  it("refunds erased ink and refills on reset", () => {
    drawLine(session, { x: 0, y: 0 }, { x: 100, y: 0 });
    session.update(0, OPEN_PAGE);
    session.update(900, OPEN_PAGE);
    expect(session.budget.remaining).toBe(500);

    session.refund(100);
    expect(session.budget.remaining).toBe(600);

    session.penDown({ x: 0, y: 0 });
    session.penMove({ x: 300, y: 0 });
    session.reset(270);
    expect(session.budget).toEqual({ total: 270, remaining: 270 });
    expect(session.isDrawing).toBe(false);
    expect(session.activeStrokes).toHaveLength(0);
  });

  it("ignores a second pointer while the pen is down", () => {
    session.penDown({ x: 0, y: 0 });
    session.penDown({ x: 500, y: 500 });
    session.penMove({ x: 50, y: 0 });
    expect(session.activeStrokes).toHaveLength(1);
  });
});
