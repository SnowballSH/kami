import { describe, expect, it } from "vitest";
import type { Vec } from "../core/geometry";
import {
  GestureMachine,
  type PointerKind,
  TWO_FINGER_TAP_MS,
  WHEEL_ZOOM_MAX_DELTA,
  WHEEL_ZOOM_RATE,
} from "./gestures";
import type { CanvasInputSink, Tool } from "./types";

type SinkCall = readonly [name: keyof CanvasInputSink, ...args: readonly unknown[]];

const at = (x: number, y: number): Vec => ({ x, y });

const setup = (initialTool: Tool = "draw") => {
  const calls: SinkCall[] = [];
  const sink: CanvasInputSink = {
    penDown: (client) => calls.push(["penDown", client]),
    penMove: (client) => calls.push(["penMove", client]),
    penUp: () => calls.push(["penUp"]),
    penCancel: () => calls.push(["penCancel"]),
    tap: (client) => calls.push(["tap", client]),
    panBy: (delta) => calls.push(["panBy", delta]),
    zoomAt: (client, factor) => calls.push(["zoomAt", client, factor]),
    undo: () => calls.push(["undo"]),
  };
  const state = { tool: initialTool, nowMs: 0 };
  const machine = new GestureMachine(
    () => state.tool,
    sink,
    () => state.nowMs,
  );
  const press = (id: number, kind: PointerKind, client: Vec, button = 0): void =>
    machine.press({ id, kind, client, button });
  const names = (): readonly string[] => calls.map(([name]) => name);
  return { machine, calls, state, press, names };
};

describe("GestureMachine", () => {
  describe("one pointer", () => {
    it("draws a stroke that travels", () => {
      const { machine, calls, press } = setup("draw");

      press(1, "touch", at(10, 10));
      machine.move(1, [at(12, 10), at(30, 14)]);
      machine.release(1);

      expect(calls).toEqual([
        ["penDown", at(10, 10)],
        ["penMove", at(12, 10)],
        ["penMove", at(30, 14)],
        ["penUp"],
      ]);
    });

    it("turns a press that never travels into penCancel then tap", () => {
      const { machine, calls, press } = setup("erase");

      press(1, "mouse", at(50, 50));
      machine.move(1, [at(53, 52)]);
      machine.release(1);

      expect(calls).toEqual([
        ["penDown", at(50, 50)],
        ["penMove", at(53, 52)],
        ["penCancel"],
        ["tap", at(50, 50)],
      ]);
    });

    it("keeps a stroke that wandered off and came back to where it started", () => {
      const { machine, names, press } = setup("draw");

      press(1, "pen", at(0, 0));
      machine.move(1, [at(40, 0)]);
      machine.move(1, [at(1, 1)]);
      machine.release(1);

      expect(names()).toEqual(["penDown", "penMove", "penMove", "penUp"]);
    });

    it("only taps with the write tool", () => {
      const { machine, calls, press } = setup("write");

      press(1, "touch", at(5, 5));
      machine.release(1);
      press(2, "touch", at(5, 5));
      machine.move(2, [at(80, 5)]);
      machine.release(2);

      expect(calls).toEqual([["tap", at(5, 5)]]);
    });

    it("pans with the pan tool once the press travels, and taps when it does not", () => {
      const { machine, calls, press } = setup("pan");

      press(1, "touch", at(100, 100));
      machine.move(1, [at(103, 100)]);
      machine.move(1, [at(110, 104)]);
      machine.move(1, [at(115, 100)]);
      machine.release(1);
      press(2, "touch", at(20, 20));
      machine.release(2);

      expect(calls).toEqual([
        ["panBy", at(10, 4)],
        ["panBy", at(5, -4)],
        ["tap", at(20, 20)],
      ]);
    });

    it("keeps the tool a press started with even if the tool changes mid-drag", () => {
      const { machine, names, state, press } = setup("draw");

      press(1, "mouse", at(0, 0));
      state.tool = "pan";
      machine.move(1, [at(20, 0)]);
      machine.release(1);

      expect(names()).toEqual(["penDown", "penMove", "penUp"]);
    });

    it("pans with the middle mouse button and ignores the other buttons", () => {
      const { machine, calls, press } = setup("draw");

      press(1, "mouse", at(0, 0), 2);
      machine.move(1, [at(30, 0)]);
      machine.release(1);
      press(1, "mouse", at(0, 0), 1);
      machine.move(1, [at(0, 25)]);
      machine.release(1);

      expect(calls).toEqual([["panBy", at(0, 25)]]);
    });

    it("ends a cancelled stroke without a tap", () => {
      const { machine, names, press } = setup("draw");

      press(1, "touch", at(0, 0));
      machine.cancel(1);
      press(2, "touch", at(0, 0));
      machine.move(2, [at(50, 0)]);
      machine.cancel(2);

      expect(names()).toEqual(["penDown", "penCancel", "penDown", "penMove", "penUp"]);
    });

    it("ignores moves from pointers that never pressed", () => {
      const { machine, calls } = setup("draw");

      machine.move(7, [at(1, 1)]);
      machine.release(7);

      expect(calls).toEqual([]);
    });
  });

  describe("two fingers", () => {
    it("cancels the stroke and pans and pinches about the midpoint", () => {
      const { machine, calls, press } = setup("draw");

      press(1, "touch", at(100, 100));
      machine.move(1, [at(120, 100)]);
      press(2, "touch", at(220, 100));
      machine.move(2, [at(320, 100)]);
      machine.move(1, [at(120, 140)]);

      expect(calls).toEqual([
        ["penDown", at(100, 100)],
        ["penMove", at(120, 100)],
        ["penCancel"],
        ["panBy", at(50, 0)],
        ["zoomAt", at(220, 100), 2],
        ["panBy", at(0, 20)],
        ["zoomAt", at(220, 120), Math.hypot(200, 40) / 200],
      ]);
    });

    it("draws nothing until every finger has lifted", () => {
      const { machine, names, press } = setup("draw");

      press(1, "touch", at(0, 0));
      press(2, "touch", at(100, 0));
      machine.release(2);
      machine.move(1, [at(60, 60)]);
      machine.release(1);

      expect(names()).toEqual(["penDown", "penCancel"]);

      press(3, "touch", at(0, 0));
      machine.move(3, [at(40, 0)]);
      machine.release(3);

      expect(names().slice(2)).toEqual(["penDown", "penMove", "penUp"]);
    });

    it("pinches with any tool and never taps", () => {
      const { machine, names, press } = setup("write");

      press(1, "touch", at(0, 0));
      press(2, "touch", at(0, 100));
      machine.move(2, [at(0, 50)]);
      machine.release(1);
      machine.release(2);

      expect(names()).toEqual(["panBy", "zoomAt"]);
    });

    it("re-anchors on the remaining pair when one of three fingers lifts", () => {
      const { machine, calls, press } = setup("pan");

      press(1, "touch", at(0, 0));
      press(2, "touch", at(100, 0));
      press(3, "touch", at(0, 300));
      machine.release(1);
      machine.move(3, [at(0, 300)]);
      machine.move(2, [at(110, 0)]);

      expect(calls).toEqual([
        ["panBy", at(5, 0)],
        ["zoomAt", at(55, 150), Math.hypot(110, 300) / Math.hypot(100, 300)],
      ]);
    });
  });

  describe("two-finger tap", () => {
    it("undoes when two fingers land and lift together without travelling", () => {
      const { machine, names, press, state } = setup("draw");

      press(1, "touch", at(100, 100));
      press(2, "touch", at(200, 100));
      machine.move(2, [at(202, 101)]);
      state.nowMs = TWO_FINGER_TAP_MS;
      machine.release(1);
      machine.release(2);

      expect(names().filter((name) => name !== "panBy" && name !== "zoomAt")).toEqual([
        "penDown",
        "penCancel",
        "undo",
      ]);
    });

    it.each([
      ["held too long", { heldMs: TWO_FINGER_TAP_MS + 1, travel: 0, fingers: 2 }],
      ["a pinch", { heldMs: 100, travel: 40, fingers: 2 }],
      ["three fingers", { heldMs: 100, travel: 0, fingers: 3 }],
    ])("does not undo when %s", (_, { heldMs, travel, fingers }) => {
      const { machine, names, press, state } = setup("pan");

      for (let id = 1; id <= fingers; id++) press(id, "touch", at(id * 100, 100));
      machine.move(2, [at(200 + travel, 100)]);
      state.nowMs = heldMs;
      for (let id = 1; id <= fingers; id++) machine.release(id);

      expect(names()).not.toContain("undo");
    });

    it("does not undo after the first finger already drew", () => {
      const { machine, names, press } = setup("draw");

      press(1, "touch", at(0, 0));
      machine.move(1, [at(30, 0)]);
      press(2, "touch", at(100, 100));
      machine.release(1);
      machine.release(2);

      expect(names()).not.toContain("undo");
    });

    it("does not undo when a finger is cancelled or a pencil joins", () => {
      const { machine, names, press } = setup("draw");

      press(1, "touch", at(0, 0));
      press(2, "touch", at(100, 0));
      machine.cancel(1);
      machine.release(2);
      press(3, "touch", at(0, 0));
      press(4, "touch", at(100, 0));
      press(5, "pen", at(50, 50));
      machine.release(3);
      machine.release(4);

      expect(names()).not.toContain("undo");
    });

    it("does not undo when fingers land while the pencil draws", () => {
      const { machine, names, press } = setup("draw");

      press(1, "pen", at(0, 0));
      press(2, "touch", at(300, 300));
      press(3, "touch", at(400, 300));
      machine.release(2);
      machine.release(3);

      expect(names()).not.toContain("undo");
    });
  });

  describe("pencil and palm", () => {
    it("lets the pencil draw while a palm rests, and ignores the palm", () => {
      const { machine, calls, press } = setup("draw");

      press(1, "touch", at(300, 300));
      machine.move(1, [at(320, 300)]);
      press(9, "pen", at(50, 50));
      press(2, "touch", at(340, 320));
      machine.move(1, [at(330, 310)]);
      machine.move(2, [at(350, 330)]);
      machine.move(9, [at(90, 50)]);
      machine.release(9);

      expect(calls).toEqual([
        ["penDown", at(300, 300)],
        ["penMove", at(320, 300)],
        ["penCancel"],
        ["penDown", at(50, 50)],
        ["penMove", at(90, 50)],
        ["penUp"],
      ]);
    });

    it("keeps ignoring the palm between pencil strokes", () => {
      const { machine, names, press } = setup("draw");

      press(1, "touch", at(300, 300));
      press(9, "pen", at(0, 0));
      machine.move(9, [at(30, 0)]);
      machine.release(9);
      machine.move(1, [at(400, 400)]);
      press(9, "pen", at(0, 20));
      machine.move(9, [at(30, 20)]);
      machine.release(9);
      machine.release(1);

      expect(names()).toEqual([
        "penDown",
        "penCancel",
        "penDown",
        "penMove",
        "penUp",
        "penDown",
        "penMove",
        "penUp",
      ]);
    });

    it("takes over from a pinch", () => {
      const { machine, names, press } = setup("draw");

      press(1, "touch", at(0, 0));
      press(2, "touch", at(100, 0));
      press(9, "pen", at(50, 50));
      machine.move(2, [at(200, 0)]);
      machine.release(9);

      expect(names()).toEqual(["penDown", "penCancel", "penDown", "penCancel", "tap"]);
    });
  });

  describe("wheel", () => {
    it("pans against the scroll direction", () => {
      const { machine, calls } = setup();

      machine.wheel({ client: at(10, 10), delta: at(4, -30), zooming: false });

      expect(calls).toEqual([["panBy", at(-4, 30)]]);
    });

    it("zooms about the cursor when pinching the trackpad, gently per notch", () => {
      const { machine, calls } = setup();

      machine.wheel({ client: at(10, 20), delta: at(0, -5), zooming: true });
      machine.wheel({ client: at(10, 20), delta: at(0, 500), zooming: true });

      expect(calls).toEqual([
        ["zoomAt", at(10, 20), Math.exp(5 * WHEEL_ZOOM_RATE)],
        ["zoomAt", at(10, 20), Math.exp(-WHEEL_ZOOM_MAX_DELTA * WHEEL_ZOOM_RATE)],
      ]);
    });
  });

  describe("abort", () => {
    it("drops a press in progress and forgets every finger", () => {
      const { machine, names, press } = setup("draw");

      press(1, "touch", at(0, 0));
      machine.abort();
      machine.move(1, [at(50, 0)]);
      press(2, "touch", at(0, 0));
      machine.move(2, [at(50, 0)]);
      machine.release(2);

      expect(names()).toEqual(["penDown", "penCancel", "penDown", "penMove", "penUp"]);
    });
  });
});
