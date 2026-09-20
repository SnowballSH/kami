import { describe, expect, it } from "vitest";
import type { Drawing, DrawingId } from "../ink/types";
import type { AliceSnapshot, SumikuiSnapshot, WorldSnapshot } from "../sim/types";
import { biteFrontier, feedingOf, feedingParticles } from "./feedingParticles";
import type { InkView } from "./types";

const alice = (x: number): AliceSnapshot => ({
  center: { x, y: 100 },
  velocity: { x: 0, y: 0 },
  width: 28,
  height: 60,
  size: "normal",
  sizeMultiplier: 1,
  headingScale: 1,
  facing: 1,
  walking: false,
  grounded: true,
  climbing: false,
  hasKey: false,
  ride: null,
  look: { kind: "alice" },
});

const BRIDGE: Drawing = {
  id: "bridge" as DrawingId,
  strokes: [
    Array.from({ length: 10 }, (_, index) => ({ x: index * 10, y: 0 })),
    Array.from({ length: 10 }, (_, index) => ({ x: 100 + index * 10, y: 0 })),
  ],
  cost: 190,
};

const bridgeView: InkView = {
  drawing: BRIDGE,
  pose: { origin: { x: 0, y: 0 }, position: { x: 500, y: 200 }, angle: 0, scale: 1 },
  nature: "ink",
  awakenedAtMs: null,
};

const sumikui = (
  quarry: SumikuiSnapshot["quarry"],
  bite: number,
  phase: SumikuiSnapshot["phase"] = "feeding",
): SumikuiSnapshot => ({
  centre: { x: 600, y: 150 },
  facing: 1,
  phase,
  quarry,
  prey: quarry === "ink" ? null : 1,
  chewing: quarry === "ink" ? BRIDGE.id : null,
  bite,
  awakeMs: 5_000,
});

const world = (eater: SumikuiSnapshot | null): WorldSnapshot => ({
  alice: alice(0),
  twins: [alice(300)],
  sumikui: eater,
  soul: null,
  tear: null,
  drawings: [],
  bites: [],
  keyTaken: false,
  doorOpen: false,
});

describe("biteFrontier", () => {
  it("sits at the end of the drawing before the first bite and walks back as it is eaten", () => {
    expect(biteFrontier(BRIDGE.strokes, 0)).toEqual({ x: 190, y: 0 });
    expect(biteFrontier(BRIDGE.strokes, 0.5)).toEqual({ x: 100, y: 0 });
    expect(biteFrontier(BRIDGE.strokes, 0.75)).toEqual({ x: 50, y: 0 });
    expect(biteFrontier(BRIDGE.strokes, 1)).toEqual({ x: 0, y: 0 });
  });

  it("has nowhere to bite on an empty drawing", () => {
    expect(biteFrontier([], 0.5)).toBeNull();
  });
});

describe("feedingOf", () => {
  it("is nothing unless the Sumikui is feeding", () => {
    expect(feedingOf(world(null), [bridgeView])).toBeNull();
    expect(feedingOf(world(sumikui("ink", 0.2, "hunting")), [bridgeView])).toBeNull();
  });

  it("flies from the chewed drawing's frontier, posed on the board, to its mouth", () => {
    const feeding = feedingOf(world(sumikui("ink", 0.5)), [bridgeView]);
    expect(feeding?.source).toEqual({ x: 600, y: 200 });
    expect(feeding?.mouth.x).toBe(600);
  });

  it("comes from the prey's feet for a paper bite and from her middle when it is swallowing her", () => {
    const paper = feedingOf(world(sumikui("paper", 0.3)), []);
    expect(paper?.source).toEqual({ x: 300, y: 130 });
    const swallow = feedingOf(world(sumikui("alice", 0.3)), []);
    expect(swallow?.source).toEqual({ x: 300, y: 100 });
  });

  it("is nothing when the chewed drawing is not in view", () => {
    expect(feedingOf(world(sumikui("ink", 0.5)), [])).toBeNull();
  });
});

describe("feedingParticles", () => {
  const feeding = { source: { x: 0, y: 0 }, mouth: { x: 100, y: -50 } };

  it("is a fixed handful, the same for the same moment", () => {
    const now = feedingParticles(feeding, 1234);
    expect(now.length).toBeLessThanOrEqual(16);
    expect(now).toEqual(feedingParticles(feeding, 1234));
    expect(now).not.toEqual(feedingParticles(feeding, 1300));
  });

  it("keeps every fleck between the meal and the mouth, and every drip below the meal", () => {
    for (const particle of feedingParticles(feeding, 777)) {
      expect(particle.at.x).toBeGreaterThanOrEqual(-40);
      expect(particle.at.x).toBeLessThanOrEqual(140);
      expect(particle.alpha).toBeGreaterThan(0);
      expect(particle.radius).toBeGreaterThan(0);
    }
  });
});
