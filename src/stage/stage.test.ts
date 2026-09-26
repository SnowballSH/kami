import { describe, expect, it, vi } from "vitest";
import type { BoardDefinition } from "../board/types";
import type { Stroke } from "../core/geometry";
import { InkLedger } from "../game/inkLedger";
import { ARRIVAL_MS, RETRACE_MS } from "../ink/retrace";
import type { DrawingId } from "../ink/types";
import type { DrawnBody } from "../sim/body/types";
import type { AliceSnapshot, DrawingPose } from "../sim/types";
import type { LawListing } from "../ui/types";
import { StageDecoder, type StagedFrame } from "./decoder";
import { StageEncoder } from "./encoder";
import { fittedCamera } from "./fit";
import { MIN_FRAME_GAP_MS, MOST_BUFFERED_BYTES, StageSource } from "./source";
import {
  ALICE,
  BOARD,
  FakeExchange,
  frameAt,
  inkOf,
  noteOf,
  scriptOf,
  strokesOf,
  VIEWPORT,
} from "./testing/fixtures";
import { StageWatcher } from "./watcher";
import {
  DEFAULT_STAGE,
  kindOf,
  pack,
  type ShownMessage,
  stageNameOf,
  stageSocketUrl,
  unpackShown,
} from "./wire";

const shown = (messages: readonly string[]): ShownMessage[] =>
  messages.flatMap((message) => unpackShown(message) ?? []);

const audience = () => {
  const boards: BoardDefinition[] = [];
  const laws: (readonly LawListing[])[] = [];
  const frames: StagedFrame[] = [];
  let dark = 0;
  return {
    boards,
    laws,
    frames,
    darkened: () => dark,
    house: {
      boardChanged: (board: BoardDefinition) => void boards.push(board),
      lawsChanged: (listed: readonly LawListing[]) => void laws.push(listed),
      frameArrived: (staged: StagedFrame) => void frames.push(staged),
      wentDark: () => {
        dark += 1;
      },
    },
  };
};

describe("the wire", () => {
  it("packs a kind and a body, and a bare kind alone", () => {
    expect(pack("go")).toBe("go");
    expect(kindOf(pack("go"))).toBe("go");
    const message = pack("laws", [{ id: "r1", text: "the floor is ice", gloss: "slippery" }]);
    expect(kindOf(message)).toBe("laws");
    expect(unpackShown(message)).toEqual({
      kind: "laws",
      body: [{ id: "r1", text: "the floor is ice", gloss: "slippery" }],
    });
  });

  it.each(["go", "frame", "frame\n", "frame\nnot json", "frame\n7", "gossip\n{}"])(
    "refuses %j as something to show",
    (message) => expect(unpackShown(message)).toBeNull(),
  );

  it("names the default stage unless the address names a well-formed one", () => {
    expect(stageNameOf(null)).toBe(DEFAULT_STAGE);
    expect(stageNameOf("")).toBe(DEFAULT_STAGE);
    expect(stageNameOf("Hall A!")).toBe(DEFAULT_STAGE);
    expect(stageNameOf("hall-a")).toBe("hall-a");
  });

  it("dials the page's own server, securely when the page is", () => {
    const at = (href: string) => ({ href }) as Location;
    expect(stageSocketUrl("main", "screen", at("http://box:8787/?screen&join=x"))).toBe(
      "ws://box:8787/api/stage/main?role=screen",
    );
    expect(stageSocketUrl("main", "source", at("https://box:8443/?mode=boss"))).toBe(
      "wss://box:8443/api/stage/main?role=source",
    );
  });
});

const wiggle = (seed: number): readonly Stroke[] =>
  Array.from({ length: 3 }, (_, line) =>
    Array.from({ length: 12 }, (_, at) => ({ x: seed + at * 5, y: line * 10 + (at % 3) })),
  );

const ANIMATED = "animated" as DrawingId;
const POSES: readonly DrawingPose[] = [
  {
    id: ANIMATED,
    pose: { origin: { x: 0, y: 0 }, position: { x: 3, y: 4 }, angle: 0, scale: 1 },
    lit: false,
  },
];

/** Every frame of `ledger`'s ink from `fromMs` to `toMs`, encoded at the source and decoded on a screen. */
const mirrorRun = (ledger: InkLedger, fromMs: number, toMs: number) => {
  const encoder = new StageEncoder();
  const seen = audience();
  const decoder = new StageDecoder(seen.house);
  encoder.setBoard(BOARD);
  const told: string[] = [];
  const sources: ReturnType<typeof frameAt>[] = [];
  for (let nowMs = fromMs; nowMs <= toMs; nowMs += 16) {
    const frame = frameAt(nowMs, { inks: ledger.views(POSES, nowMs) });
    sources.push(frame);
    const messages = encoder.encode(frame, VIEWPORT);
    told.push(...messages);
    for (const message of shown(messages)) decoder.take(message);
  }
  const inkMessages = told.filter((message) => kindOf(message) === "ink");
  return { sources, frames: seen.frames.map(({ frame }) => frame), inkMessages };
};

describe("ink still coming in", () => {
  it("tells Kami's inking-in once, and the screen draws it in stroke for stroke on the frames' clock", () => {
    const ledger = new InkLedger();
    ledger.conjure({ id: ANIMATED, strokes: wiggle(0), cost: 30 }, 1000);
    const { sources, frames, inkMessages } = mirrorRun(ledger, 1000, 1000 + ARRIVAL_MS + 100);
    expect(inkMessages).toHaveLength(1);
    expect(frames.map((frame) => frame.inks)).toEqual(sources.map((frame) => frame.inks));
    expect(sources[3]?.inks[0]?.drawing.strokes).not.toEqual(wiggle(0));
  });

  it("tells a retrace once, with the strokes it leaves, and the screen glides them the same way", () => {
    const ledger = new InkLedger();
    ledger.add({ id: ANIMATED, strokes: wiggle(0), cost: 30 });
    ledger.retrace(ANIMATED, [...wiggle(2), ...wiggle(40)], 1000);
    const { sources, frames, inkMessages } = mirrorRun(ledger, 900, 1000 + RETRACE_MS + 100);
    expect(inkMessages).toHaveLength(1);
    expect(frames.map((frame) => frame.inks)).toEqual(sources.map((frame) => frame.inks));
  });
});

describe("encoder and decoder", () => {
  it("rebuild on the screen exactly what the renderer was shown", () => {
    const encoder = new StageEncoder();
    const seen = audience();
    const decoder = new StageDecoder(seen.house);
    const frame = frameAt(16, {
      inks: [inkOf("d1", strokesOf(1)), inkOf("d2", strokesOf(2))],
      notes: [noteOf("n1", scriptOf("hello"))],
      activeStrokes: strokesOf(9),
      events: [{ type: "key-taken" }],
    });
    encoder.setBoard(BOARD);
    encoder.setLaws([{ id: "r1" as LawListing["id"], text: "ice", gloss: "slippery" }]);
    for (const message of shown(encoder.encode(frame, VIEWPORT))) decoder.take(message);
    expect(seen.boards).toEqual([BOARD]);
    expect(seen.laws).toEqual([[{ id: "r1", text: "ice", gloss: "slippery" }]]);
    expect(seen.frames).toEqual([{ frame, viewport: VIEWPORT }]);
  });

  it("send strokes and scripts once, and again only when the game hands over new ones", () => {
    const encoder = new StageEncoder();
    const strokes = strokesOf(1);
    const script = scriptOf("hi");
    const frame = frameAt(0, { inks: [inkOf("d1", strokes)], notes: [noteOf("n1", script)] });
    encoder.setBoard(BOARD);
    expect(encoder.encode(frame, VIEWPORT).map(kindOf)).toEqual([
      "board",
      "laws",
      "ink",
      "note",
      "frame",
    ]);
    expect(encoder.encode({ ...frame, nowMs: 33 }, VIEWPORT).map(kindOf)).toEqual(["frame"]);
    const retraced = frameAt(66, { inks: [inkOf("d1", strokesOf(1))], notes: frame.notes });
    expect(encoder.encode(retraced, VIEWPORT).map(kindOf)).toEqual(["ink", "frame"]);
  });

  it("tell everything again after starting over, and a drawing again after it was gone", () => {
    const encoder = new StageEncoder();
    const ink = inkOf("d1", strokesOf(1));
    encoder.setBoard(BOARD);
    encoder.encode(frameAt(0, { inks: [ink] }), VIEWPORT);
    encoder.encode(frameAt(33), VIEWPORT);
    expect(encoder.encode(frameAt(66, { inks: [ink] }), VIEWPORT).map(kindOf)).toEqual([
      "ink",
      "frame",
    ]);
    encoder.startOver();
    expect(encoder.encode(frameAt(99, { inks: [ink] }), VIEWPORT).map(kindOf)).toEqual([
      "board",
      "laws",
      "ink",
      "frame",
    ]);
  });

  it("tell every drawing again after the board is set again, because the screen forgets on a board", () => {
    const encoder = new StageEncoder();
    const seen = audience();
    const decoder = new StageDecoder(seen.house);
    const frame = frameAt(0, {
      inks: [inkOf("d1", strokesOf(1))],
      notes: [noteOf("n1", scriptOf("hi"))],
    });
    encoder.setBoard(BOARD);
    for (const message of shown(encoder.encode(frame, VIEWPORT))) decoder.take(message);
    encoder.setBoard(BOARD);
    const again = encoder.encode({ ...frame, nowMs: 33 }, VIEWPORT);
    expect(again.map(kindOf)).toEqual(["board", "laws", "ink", "note", "frame"]);
    for (const message of shown(again)) decoder.take(message);
    expect(seen.frames.at(-1)?.frame.inks.map(({ drawing }) => drawing.id)).toEqual(["d1"]);
    expect(seen.frames.at(-1)?.frame.notes.map(({ id }) => id)).toEqual(["n1"]);
  });

  it("send a body the player drew for Alice once, and show Kami's sketch of her if it never came", () => {
    const encoder = new StageEncoder();
    const seen = audience();
    const decoder = new StageDecoder(seen.house);
    const body = {
      strokes: [],
      heart: { x: 0, y: 0 },
      frame: {},
      fullest: {},
    } as unknown as DrawnBody;
    const drawn = {
      ...ALICE,
      look: { kind: "drawn", body, scale: 1, abilities: {}, clockMs: 5 },
    } as AliceSnapshot;
    const frame = frameAt(0, {
      world: { ...frameAt(0).world, alice: drawn, twins: [drawn] },
      ghosts: [drawn],
    });
    const first = encoder.encode(frame, VIEWPORT);
    expect(first.map(kindOf)).toEqual(["laws", "body", "frame"]);
    expect(first.at(-1)).not.toContain("heart");
    expect(encoder.encode({ ...frame, nowMs: 33 }, VIEWPORT).map(kindOf)).toEqual(["frame"]);
    for (const message of shown(first)) decoder.take(message);
    expect(seen.frames[0]?.frame.world.alice).toEqual(drawn);
    expect(seen.frames[0]?.frame.world.twins).toEqual([drawn]);
    expect(seen.frames[0]?.frame.ghosts).toEqual([drawn]);

    const bodiless = new StageDecoder(seen.house);
    for (const message of shown(first)) if (message.kind !== "body") bodiless.take(message);
    expect(seen.frames.at(-1)?.frame.world.alice?.look).toEqual({ kind: "alice" });
  });

  it("send ink still under the pen to a tenth of a pixel", () => {
    const encoder = new StageEncoder();
    const wet = [[{ x: 1.23456, y: 7.98765, pressure: 0.456789 }]];
    const [, message] = encoder.encode(frameAt(0, { activeStrokes: wet }), VIEWPORT);
    const lean = unpackShown(message ?? "");
    expect(lean?.kind === "frame" && lean.body.activeStrokes).toEqual([
      [{ x: 1.2, y: 8, pressure: 0.46 }],
    ]);
  });

  it("carry the events of frames that were not sent with the next one that is", () => {
    const encoder = new StageEncoder();
    const seen = audience();
    const decoder = new StageDecoder(seen.house);
    encoder.skip(frameAt(0, { events: [{ type: "key-taken" }] }));
    encoder.skip(frameAt(16));
    const messages = encoder.encode(frameAt(33, { events: [{ type: "door-opened" }] }), VIEWPORT);
    for (const message of shown(messages)) decoder.take(message);
    expect(seen.frames[0]?.frame.events).toEqual([{ type: "key-taken" }, { type: "door-opened" }]);
  });

  it("leave out an ink whose strokes never arrived rather than fail the frame", () => {
    const encoder = new StageEncoder();
    const seen = audience();
    const decoder = new StageDecoder(seen.house);
    const frame = frameAt(0, { inks: [inkOf("d1", strokesOf(1)), inkOf("d2", strokesOf(2))] });
    const messages = shown(encoder.encode(frame, VIEWPORT));
    for (const message of messages) {
      if (message.kind === "ink" && message.body.id === "d2") continue;
      decoder.take(message);
    }
    expect(seen.frames[0]?.frame.inks.map(({ drawing }) => drawing.id)).toEqual(["d1"]);
  });
});

describe("StageSource", () => {
  const live = () => {
    const exchange = new FakeExchange();
    const source = new StageSource(exchange.dial, exchange.schedule, () => 0.5);
    source.setBoard(BOARD);
    exchange.open();
    return { exchange, source };
  };

  it("shows nothing until a screen watches, then starts from the board", () => {
    const { exchange, source } = live();
    source.show(frameAt(0), VIEWPORT);
    expect(exchange.sent).toEqual([]);
    exchange.say("go");
    source.show(frameAt(100), VIEWPORT);
    expect(exchange.kinds()).toEqual(["board", "laws", "frame"]);
    exchange.say("rest");
    source.show(frameAt(200), VIEWPORT);
    expect(exchange.kinds()).toEqual(["board", "laws", "frame"]);
  });

  it("starts over when told to go again, which is how a new screen catches up", () => {
    const { exchange, source } = live();
    exchange.say("go");
    source.show(frameAt(0), VIEWPORT);
    exchange.say("go");
    source.show(frameAt(100), VIEWPORT);
    expect(exchange.kinds()).toEqual(["board", "laws", "frame", "board", "laws", "frame"]);
  });

  it("sends about thirty frames a second however fast the device paints", () => {
    const { exchange, source } = live();
    exchange.say("go");
    for (let nowMs = 0; nowMs < 1000; nowMs += 1000 / 120) source.show(frameAt(nowMs), VIEWPORT);
    const frames = exchange.kinds().filter((kind) => kind === "frame").length;
    expect(frames).toBeGreaterThanOrEqual(28);
    expect(frames).toBeLessThanOrEqual(Math.ceil(1000 / MIN_FRAME_GAP_MS) + 1);
  });

  it("holds frames back while the link is behind", () => {
    const { exchange, source } = live();
    exchange.say("go");
    exchange.queued = MOST_BUFFERED_BYTES + 1;
    source.show(frameAt(0, { events: [{ type: "key-taken" }] }), VIEWPORT);
    expect(exchange.sent).toEqual([]);
    exchange.queued = 0;
    source.show(frameAt(100), VIEWPORT);
    const last = unpackShown(exchange.sent.at(-1) ?? "");
    expect(last?.kind === "frame" && last.body.events).toEqual([{ type: "key-taken" }]);
  });

  it("says when someone is drawing, even while resting, about once a second", () => {
    const { exchange, source } = live();
    const drawing = { activeStrokes: strokesOf(1) };
    source.show(frameAt(0, drawing), VIEWPORT);
    source.show(frameAt(500, drawing), VIEWPORT);
    source.show(frameAt(1000, drawing), VIEWPORT);
    source.show(frameAt(1500), VIEWPORT);
    expect(exchange.sent).toEqual(["active", "active"]);
  });

  it("rests when the line drops and dials again, ever more patiently", () => {
    const { exchange, source } = live();
    exchange.say("go");
    exchange.drop();
    exchange.redial();
    exchange.drop();
    expect(exchange.retries).toEqual([1000, 2000]);
    const early = new FakeExchange();
    new StageSource(early.dial, early.schedule, () => 0);
    early.drop();
    expect(early.retries).toEqual([750]);
    exchange.redial();
    exchange.open();
    source.show(frameAt(0), VIEWPORT);
    expect(exchange.sent).toEqual([]);
    expect(exchange.dials).toBe(3);
  });
});

describe("StageWatcher", () => {
  it("hands the house what the source shows and goes dark when told, or when the line drops", () => {
    const exchange = new FakeExchange();
    const seen = audience();
    new StageWatcher(exchange.dial, seen.house, exchange.schedule);
    exchange.open();
    const encoder = new StageEncoder();
    encoder.setBoard(BOARD);
    const frame = frameAt(0, { inks: [inkOf("d1", strokesOf(1))] });
    for (const message of encoder.encode(frame, VIEWPORT)) exchange.say(message);
    exchange.say("gibberish");
    expect(seen.frames).toEqual([{ frame: { ...frame, events: [] }, viewport: VIEWPORT }]);
    exchange.say("offstage");
    exchange.drop();
    expect(seen.darkened()).toBe(2);
  });

  it("outlives a message that is not what it says, and shows the next one", () => {
    const exchange = new FakeExchange();
    const seen = audience();
    new StageWatcher(exchange.dial, seen.house, exchange.schedule);
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    exchange.say('frame\n{"inks":null,"notes":[]}');
    expect(warned).toHaveBeenCalledTimes(1);
    warned.mockRestore();
    for (const message of new StageEncoder().encode(frameAt(0), VIEWPORT)) exchange.say(message);
    expect(seen.frames).toHaveLength(1);
  });

  it("forgets the last source's drawings when the stage goes dark", () => {
    const exchange = new FakeExchange();
    const seen = audience();
    new StageWatcher(exchange.dial, seen.house, exchange.schedule);
    const encoder = new StageEncoder();
    const frame = frameAt(0, { inks: [inkOf("d1", strokesOf(1))] });
    const [, ink, lean] = encoder.encode(frame, VIEWPORT);
    exchange.say(ink ?? "");
    exchange.say("offstage");
    exchange.say(lean ?? "");
    expect(seen.frames[0]?.frame.inks).toEqual([]);
  });
});

describe("fittedCamera", () => {
  const camera = { center: { x: 5, y: 6 }, zoom: 2, angle: 10 };

  it("shows all of what the source sees, as large as the screen allows", () => {
    expect(fittedCamera(camera, VIEWPORT, { width: 2048, height: 1536 })).toEqual({
      ...camera,
      zoom: 4,
    });
    expect(fittedCamera(camera, VIEWPORT, { width: 3840, height: 1536 }).zoom).toBe(4);
    expect(fittedCamera(camera, VIEWPORT, { width: 512, height: 768 }).zoom).toBe(1);
  });

  it("leaves the camera alone when either canvas has no size yet", () => {
    expect(fittedCamera(camera, { width: 0, height: 0 }, VIEWPORT)).toBe(camera);
    expect(fittedCamera(camera, VIEWPORT, { width: 0, height: 0 })).toBe(camera);
  });
});
