// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_FRAME_BYTES, pack } from "../../src/stage/wire";
import { HANDOVER_IDLE_MS, MOST_BUFFERED_BYTES, type Seat, Stage, StageHub } from "./stageHub";

class FakeSeat implements Seat {
  readonly heard: string[] = [];
  queued = 0;
  send(message: string): void {
    this.heard.push(message);
  }
  buffered(): number {
    return this.queued;
  }
}

const FRAME = pack("frame", { nowMs: 1 });
const INK = pack("ink", { id: "d1", strokes: [] });

const staged = () => {
  let nowMs = 0;
  const stage = new Stage(() => nowMs);
  return { stage, advance: (ms: number) => (nowMs += ms) };
};

describe("Stage", () => {
  it("tells a screen nobody is playing, then sends the first source live when one arrives", () => {
    const { stage } = staged();
    const [screen, ipad] = [new FakeSeat(), new FakeSeat()];
    stage.screenJoined(screen);
    expect(screen.heard).toEqual(["offstage"]);
    stage.sourceJoined(ipad);
    expect(ipad.heard).toEqual(["go"]);
  });

  it("leaves a source resting until a screen watches, and rests it again when the last one leaves", () => {
    const { stage } = staged();
    const [screen, ipad] = [new FakeSeat(), new FakeSeat()];
    stage.sourceJoined(ipad);
    stage.said(ipad, FRAME);
    expect(ipad.heard).toEqual([]);
    stage.screenJoined(screen);
    expect(ipad.heard).toEqual(["go"]);
    stage.left(screen);
    expect(ipad.heard).toEqual(["go", "rest"]);
  });

  it("passes on what the live source shows, word for word, and nothing a resting one says", () => {
    const { stage } = staged();
    const [screen, ipad, other] = [new FakeSeat(), new FakeSeat(), new FakeSeat()];
    stage.screenJoined(screen);
    stage.sourceJoined(ipad);
    stage.sourceJoined(other);
    stage.said(ipad, INK);
    stage.said(ipad, FRAME);
    stage.said(other, FRAME);
    stage.said(ipad, pack("nonsense", {}));
    stage.said(screen, FRAME);
    expect(screen.heard).toEqual(["offstage", INK, FRAME]);
    expect(other.heard).toEqual([]);
  });

  it("asks the live source to start over when another screen joins", () => {
    const { stage } = staged();
    const [first, second, ipad] = [new FakeSeat(), new FakeSeat(), new FakeSeat()];
    stage.sourceJoined(ipad);
    stage.screenJoined(first);
    stage.screenJoined(second);
    expect(ipad.heard).toEqual(["go", "go"]);
  });

  it("hands the stage to a device that draws once the one in play has been idle long enough", () => {
    const { stage, advance } = staged();
    const [screen, ipad, other] = [new FakeSeat(), new FakeSeat(), new FakeSeat()];
    stage.screenJoined(screen);
    stage.sourceJoined(ipad);
    stage.sourceJoined(other);
    stage.said(ipad, pack("active"));
    advance(HANDOVER_IDLE_MS - 1);
    stage.said(other, pack("active"));
    expect(other.heard).toEqual([]);
    advance(1);
    stage.said(other, pack("active"));
    expect(other.heard).toEqual(["go"]);
    expect(ipad.heard).toEqual(["go", "rest"]);
    stage.said(ipad, FRAME);
    stage.said(other, FRAME);
    expect(screen.heard.filter((message) => message === FRAME)).toHaveLength(1);
  });

  it("passes the stage to whoever drew last when the live device leaves, or goes dark", () => {
    const { stage, advance } = staged();
    const [screen, ipad, second, third] = [
      new FakeSeat(),
      new FakeSeat(),
      new FakeSeat(),
      new FakeSeat(),
    ];
    stage.screenJoined(screen);
    stage.sourceJoined(ipad);
    stage.sourceJoined(second);
    stage.sourceJoined(third);
    advance(10);
    stage.said(third, pack("active"));
    stage.left(ipad);
    expect(third.heard).toEqual(["go"]);
    expect(second.heard).toEqual([]);
    stage.left(third);
    expect(second.heard).toEqual(["go"]);
    stage.left(second);
    expect(screen.heard.at(-1)).toBe("offstage");
    expect(stage.empty).toBe(false);
    stage.left(screen);
    expect(stage.empty).toBe(true);
  });

  it("drops frames for a screen that has fallen behind, but never a drawing", () => {
    const { stage } = staged();
    const [slow, ipad] = [new FakeSeat(), new FakeSeat()];
    stage.sourceJoined(ipad);
    stage.screenJoined(slow);
    slow.queued = MOST_BUFFERED_BYTES + 1;
    stage.said(ipad, FRAME);
    stage.said(ipad, INK);
    expect(slow.heard).toEqual([INK]);
  });

  it("measures a message in bytes, not characters", () => {
    const { stage } = staged();
    const [screen, ipad] = [new FakeSeat(), new FakeSeat()];
    stage.sourceJoined(ipad);
    stage.screenJoined(screen);
    stage.said(ipad, pack("frame", { padding: "字".repeat(MAX_FRAME_BYTES / 2) }));
    expect(screen.heard).toEqual([]);
  });

  it("drops a frame too large to be one", () => {
    const { stage } = staged();
    const [screen, ipad] = [new FakeSeat(), new FakeSeat()];
    stage.sourceJoined(ipad);
    stage.screenJoined(screen);
    stage.said(ipad, pack("frame", { padding: "x".repeat(MAX_FRAME_BYTES) }));
    expect(screen.heard).toEqual([]);
  });
});

describe("StageHub", () => {
  it("keeps stages apart and forgets one nobody is on", () => {
    const hub = new StageHub();
    const [screen, ipad, elsewhere] = [new FakeSeat(), new FakeSeat(), new FakeSeat()];
    hub.stage("main").screenJoined(screen);
    hub.stage("main").sourceJoined(ipad);
    hub.stage("side").sourceJoined(elsewhere);
    expect(ipad.heard).toEqual(["go"]);
    expect(elsewhere.heard).toEqual([]);
    const main = hub.stage("main");
    hub.left("main", screen);
    hub.left("main", ipad);
    expect(hub.stage("main")).not.toBe(main);
  });
});
