import { describe, expect, it } from "vitest";
import type { Scene, SceneInk } from "../autopilot/types";
import { ENDLESS_GROUND, endlessBoard } from "../board/boards/endless";
import type { Nature } from "../cat/types";
import type { Vec } from "../core/geometry";
import type { DrawingId } from "../ink/types";
import { EARTH } from "../rules/types";
import { bounceArcUnder, jumpArcUnder, walkSpeedAt } from "../sim/flight";
import { ALICE_BASE, type AliceSnapshot } from "../sim/types";
import { BRIDGE_LINE, counselFor, DROP_LINE, IDEAS, LADDER_LINE } from "./counsel";
import { isIdeaRequest } from "./requests";
import { stretchSketch } from "./sketching";
import { surroundingsOf } from "./surroundings";

const groundEnd = ENDLESS_GROUND.x + ENDLESS_GROUND.width;

const alice = (feet: Vec, facing: 1 | -1 = 1): AliceSnapshot => ({
  center: { x: feet.x, y: feet.y - ALICE_BASE.height / 2 },
  width: ALICE_BASE.width,
  height: ALICE_BASE.height,
  size: "normal",
  sizeMultiplier: 1,
  headingScale: 1,
  facing,
  walking: false,
  grounded: true,
  climbing: false,
  hasKey: false,
  velocity: { x: 0, y: 0 },
  ride: null,
  look: { kind: "alice" },
});

const line = (from: Vec, to: Vec, spacing = 4): Vec[] => {
  const count = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / spacing);
  return Array.from({ length: count + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / count,
    y: from.y + ((to.y - from.y) * i) / count,
  }));
};

const ink = (id: string, strokes: readonly Vec[][], nature: Nature = "solid"): SceneInk => ({
  drawing: { id: id as DrawingId, strokes, cost: 0 },
  pose: { origin: { x: 0, y: 0 }, position: { x: 0, y: 0 }, angle: 0, scale: 1 },
  nature,
  strength: 1,
});

const scene = (overrides: Partial<Scene> = {}): Scene => ({
  board: endlessBoard("together"),
  alice: alice({ x: 0, y: ENDLESS_GROUND.y }),
  others: [],
  inks: [],
  bites: [],
  sumikui: null,
  keyTaken: false,
  doorOpen: false,
  walkSpeed: walkSpeedAt(1),
  canFly: false,
  bounceArc: (strength) => bounceArcUnder(EARTH, strength),
  jumpArc: jumpArcUnder(EARTH, 1),
  ...overrides,
});

const farBank = ink("bank", [line({ x: groundEnd + 220, y: 0 }, { x: groundEnd + 500, y: 0 })]);
const wall = ink("wall", [
  line({ x: 200, y: 0 }, { x: 200, y: -320 }),
  line({ x: 200, y: -320 }, { x: 260, y: -320 }),
  line({ x: 260, y: -320 }, { x: 260, y: 0 }),
]);
const step = ink("step", [line({ x: 200, y: -40 }, { x: 260, y: -40 })]);
const longGround = ink("long", [line({ x: -1600, y: 20 }, { x: 1600, y: 20 })]);

describe("reading the page around Alice", () => {
  it("sees the ground end in a drop when nothing is drawn beyond", () => {
    const seen = surroundingsOf(scene());
    expect(seen.kind).toBe("drop");
    if (seen.kind === "drop") expect(seen.edge.x).toBeCloseTo(groundEnd, -1);
  });

  it("sees a gap when ground picks up again within reach", () => {
    const seen = surroundingsOf(scene({ inks: [farBank] }));
    expect(seen.kind).toBe("gap");
    if (seen.kind === "gap") {
      expect(seen.span.x).toBeCloseTo(groundEnd, -2);
      expect(seen.span.x + seen.span.width).toBeCloseTo(groundEnd + 220, -2);
      expect(seen.span.y).toBe(0);
    }
  });

  it("sees a wall in a rise too tall to jump, but walks up a step", () => {
    const seen = surroundingsOf(scene({ inks: [wall] }));
    expect(seen.kind).toBe("wall");
    if (seen.kind === "wall") {
      expect(seen.face.x).toBeCloseTo(200, -2);
      expect(seen.face.y).toBeCloseTo(-320, -2);
      expect(seen.face.height).toBeCloseTo(320, -2);
      expect(seen.toward).toBe(1);
    }
    expect(surroundingsOf(scene({ inks: [step] })).kind).toBe("drop");
  });

  it("minds a gap or a wall behind her over the page merely ending ahead", () => {
    const wallBehind = surroundingsOf(scene({ alice: alice({ x: 0, y: 0 }, -1), inks: [wall] }));
    expect(wallBehind.kind).toBe("wall");
    if (wallBehind.kind === "wall") expect(wallBehind.toward).toBe(1);
    const gapBehind = surroundingsOf(scene({ alice: alice({ x: 0, y: 0 }, -1), inks: [farBank] }));
    expect(gapBehind.kind).toBe("gap");
    const wallAhead = surroundingsOf(scene({ inks: [wall, farBank] }));
    expect(wallAhead.kind).toBe("wall");
  });

  it("calls a long stretch of ground open, with room beside her", () => {
    const seen = surroundingsOf(scene({ inks: [longGround] }));
    expect(seen.kind).toBe("open");
    if (seen.kind === "open") expect(seen.beside.x).toBeGreaterThan(ALICE_BASE.width);
  });
});

describe("what Kami counsels", () => {
  it("bridges a gap from bank to bank", () => {
    const advice = counselFor({ kind: "gap", span: { x: 400, y: 0, width: 220, height: 0 } }, 0);
    expect(advice.line).toBe(BRIDGE_LINE);
    expect(advice.sketch?.word).toBe("bridge");
    expect(advice.sketch?.fit).toBe("stretch");
    expect(advice.sketch?.box.x).toBeLessThan(400);
    expect((advice.sketch?.box.x ?? 0) + (advice.sketch?.box.width ?? 0)).toBeGreaterThan(620);
    expect((advice.sketch?.box.y ?? 0) + (advice.sketch?.box.height ?? 0)).toBe(0);
  });

  it("leans a ladder on her side of a wall, as tall as the wall", () => {
    const face = { x: 200, y: -320, width: 0, height: 320 };
    const ahead = counselFor({ kind: "wall", face, toward: 1 }, 0);
    expect(ahead.line).toBe(LADDER_LINE);
    expect(ahead.sketch?.word).toBe("ladder");
    expect((ahead.sketch?.box.x ?? 0) + (ahead.sketch?.box.width ?? 0)).toBe(200);
    expect(ahead.sketch?.box.height).toBe(320);
    const behind = counselFor({ kind: "wall", face: { ...face, x: -200 }, toward: -1 }, 0);
    expect(behind.sketch?.box.x).toBe(-200);
  });

  it("asks for more page at a drop, and takes ideas in turn on open ground", () => {
    expect(counselFor({ kind: "drop", edge: { x: 400, y: 0 } }, 3)).toEqual({
      line: DROP_LINE,
      sketch: null,
    });
    const open = { kind: "open", beside: { x: 80, y: 0 } } as const;
    const lines = IDEAS.map((_, turn) => counselFor(open, turn).line);
    expect(lines).toEqual(IDEAS.map((idea) => idea.line));
    expect(counselFor(open, IDEAS.length).line).toBe(IDEAS[0]?.line);
    expect(counselFor(open, 0).sketch).toEqual({
      word: "rabbit",
      fit: "keep",
      box: { x: 32, y: -96, width: 96, height: 96 },
    });
    expect(counselFor(open, 1).sketch).toBeNull();
  });
});

describe("asking for ideas", () => {
  it("hears the sandbox asks, punctuation and all", () => {
    for (const ask of [
      "what can I do?",
      "How do I get across?",
      "how do we get up there",
      "give me an idea",
      "any ideas?",
      "idea!",
      "what should I do",
      "now what",
    ])
      expect(isIdeaRequest(ask), ask).toBe(true);
  });

  it("leaves laws, names and wishes alone", () => {
    for (const text of [
      "g = moon",
      "a rabbit",
      "summon a bridge",
      "ideal gas",
      "the cat follows me",
    ])
      expect(isIdeaRequest(text), text).toBe(false);
  });
});

describe("stretching a sketch", () => {
  it("pulls the picture over the whole box", () => {
    const square = [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    ];
    expect(stretchSketch(square, { x: 100, y: 50, width: 300, height: 20 })).toEqual([
      [
        { x: 100, y: 50 },
        { x: 400, y: 50 },
        { x: 400, y: 70 },
        { x: 100, y: 70 },
      ],
    ]);
  });
});
