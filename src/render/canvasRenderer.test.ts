import { describe, expect, it } from "vitest";
import type { Vec } from "../core/geometry";
import type { Handwriting } from "../handwriting/types";
import type { AliceSnapshot } from "../sim/types";
import { TAU } from "./canvas2d";
import { CanvasRenderer, GHOST_ALPHA } from "./canvasRenderer";
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

const frame = (eraserActive: boolean, ghosts?: readonly AliceSnapshot[]): RenderFrame => ({
  nowMs: 0,
  camera: { center: { x: 20, y: 20 }, zoom: 2, angle: 0 },
  world: {
    alice: {
      center: { x: FAR_AWAY, y: FAR_AWAY },
      width: 40,
      height: 80,
      size: "normal",
      sizeMultiplier: 1,
      headingScale: 1,
      facing: 1,
      walking: false,
      grounded: true,
      climbing: false,
      hasKey: false,
      look: { kind: "alice" },
    },
    soul: null,
    tear: null,
    twins: [],
    sumikui: null,
    drawings: [],
    bites: [],
    keyTaken: false,
    doorOpen: false,
  },
  daylight: 1,
  inks: [],
  notes: [],
  activeStrokes: [],
  activeVerdict: "ok",
  heldInks: [],
  eraserActive,
  ...(ghosts === undefined ? {} : { ghosts }),
});

const ghostAt = (center: Vec): AliceSnapshot => {
  const { alice } = frame(false).world;
  if (alice === null) throw new Error("Nobody is on the board");
  return { ...alice, center };
};

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
        calls.push({ method: `set ${String(key)}`, args: [value] });
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

describe("CanvasRenderer ghosts", () => {
  const faintStrokes = (calls: readonly Call[]): number => {
    const faded = calls.findIndex(
      ({ method, args }) => method === "set globalAlpha" && args[0] === GHOST_ALPHA,
    );
    if (faded === -1) return -1;
    const restored = calls.findIndex(({ method }, index) => index > faded && method === "restore");
    return calls
      .slice(faded, restored)
      .filter(({ method }) => method === "fill" || method === "stroke").length;
  };

  it("paints other devices' Alices faint, when they are in view", () => {
    const { renderer, calls } = setup();
    renderer.render(frame(false, [ghostAt({ x: 30, y: 30 })]));
    expect(faintStrokes(calls)).toBeGreaterThan(0);
  });

  it("skips ghosts far off screen, and sets no faintness when there are none", () => {
    const { renderer, calls } = setup();
    renderer.render(frame(false, [ghostAt({ x: -FAR_AWAY, y: -FAR_AWAY })]));
    expect(faintStrokes(calls)).toBe(0);
    calls.length = 0;
    renderer.render(frame(false));
    expect(faintStrokes(calls)).toBe(-1);
  });
});
