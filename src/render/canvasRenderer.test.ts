import { describe, expect, it, vi } from "vitest";
import { IDENTITY_POSE } from "../core/geometry";
import type { Handwriting } from "../handwriting/types";
import { drawingOf } from "../sim/testSupport";
import { TAU } from "./canvas2d";
import { CanvasRenderer } from "./canvasRenderer";
import { ERASER_RING } from "./eraserRing";
import type { RenderFrame } from "./types";

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

const SILENT: Handwriting = {
  write: (text) => ({
    text,
    strokes: [],
    startsAtMs: [],
    endsAtMs: [],
    durationMs: 0,
    bounds: { x: 0, y: 0, width: 0, height: 0 },
  }),
  reveal: () => [],
};

const CANVAS_ORIGIN = { x: 100, y: 50 };
const FAR_AWAY = 1e6;

const frame = (eraserActive: boolean): RenderFrame => ({
  nowMs: 0,
  camera: { center: { x: 20, y: 20 }, zoom: 2 },
  world: {
    alice: {
      center: { x: FAR_AWAY, y: FAR_AWAY },
      width: 40,
      height: 80,
      size: "normal",
      facing: 1,
      walking: false,
      grounded: true,
      climbing: false,
      hasKey: false,
    },
    twins: [],
    sumikui: null,
    drawings: [],
    keyTaken: false,
    doorOpen: false,
  },
  daylight: 1,
  inks: [],
  notes: [],
  activeStrokes: [],
  activeVerdict: "ok",
  eraserActive,
});

const setup = () => {
  const calls: Call[] = [];
  const state = new Map<string | symbol, unknown>();
  const ctx = new Proxy(
    {},
    {
      get: (_, key) =>
        state.get(key) ??
        ((...args: unknown[]) => {
          calls.push({ method: String(key), args });
        }),
      set: (_, key, value) => {
        state.set(key, value);
        return true;
      },
    },
  );
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "getContext", { value: () => ctx });
  Object.defineProperty(canvas, "getBoundingClientRect", {
    value: () => new DOMRect(CANVAS_ORIGIN.x, CANVAS_ORIGIN.y, 800, 600),
  });
  const renderer = new CanvasRenderer(canvas, SILENT);
  const rings = (): readonly Call[] =>
    calls.filter(({ method, args }) => method === "arc" && args[2] === ERASER_RING.screenRadius);
  const touch = (type: string, clientX: number, clientY: number): void => {
    canvas.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        isPrimary: true,
        pointerType: "touch",
        clientX,
        clientY,
      }),
    );
  };
  return { renderer, calls, rings, touch };
};

it("refreshes a completed drawing's cached path when its points change at the same stroke count", () => {
  vi.stubGlobal(
    "Path2D",
    class {
      moveTo() {}
      quadraticCurveTo() {}
      closePath() {}
    },
  );
  try {
    const { renderer, calls } = setup();
    const original = drawingOf("tidied", [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ]);
    const ink = {
      drawing: original,
      pose: IDENTITY_POSE,
      nature: "ink",
      awakenedAtMs: null,
    } as const;
    const path = () => calls.findLast(({ method }) => method === "fill")?.args[0];
    renderer.render({ ...frame(false), inks: [ink] });
    const before = path();
    expect(before).toBeDefined();
    renderer.render({ ...frame(false), inks: [ink] });
    expect(path()).toBe(before);
    const drawing = {
      ...original,
      strokes: [
        [
          { x: 0, y: 4 },
          { x: 40, y: 4 },
        ],
      ],
    };
    renderer.render({ ...frame(false), inks: [{ ...ink, drawing }] });
    expect(path()).not.toBe(before);
  } finally {
    vi.unstubAllGlobals();
  }
});

describe("CanvasRenderer eraser cursor", () => {
  it("rings the pointer last of all, in screen space, while the eraser is out", () => {
    const { renderer, calls, rings, touch } = setup();

    touch("pointerdown", 220, 130);
    renderer.render(frame(true));

    expect(rings().map(({ args }) => args)).toEqual([[120, 80, ERASER_RING.screenRadius, 0, TAU]]);
    const lastTransform = calls.findLast(({ method }) => method === "setTransform");
    expect(lastTransform?.args).toEqual([1, 0, 0, 1, 0, 0]);
    expect(calls.at(-1)?.method).toBe("stroke");
  });

  it("draws no ring for any other tool", () => {
    const { renderer, rings, touch } = setup();

    touch("pointerdown", 220, 130);
    renderer.render(frame(false));

    expect(rings()).toEqual([]);
  });

  it("draws no ring once the finger has lifted", () => {
    const { renderer, rings, touch } = setup();

    touch("pointerdown", 220, 130);
    touch("pointerup", 220, 130);
    renderer.render(frame(true));

    expect(rings()).toEqual([]);
  });
});
