import { describe, expect, it } from "vitest";
import { createAutopilot } from "../autopilot";
import type { SceneInk } from "../autopilot/types";
import type { BoardDefinition } from "../board/types";
import type { Nature } from "../cat/types";
import type { Rect } from "../core/geometry";
import type { Drawing } from "../ink/types";
import { EARTH } from "../rules/types";
import {
  drawingOf,
  enter,
  idOf,
  LEFT,
  line,
  RIGHT,
  rulingOf,
  runSteps,
  runUntil,
  STAY,
} from "../sim/testSupport";
import type { AliceIndex, SimEvent, Simulation } from "../sim/types";
import { type Page, Party } from "./party";

const GROUND_Y = 400;
const LEDGE: Rect = { x: 500, y: 280, width: 200, height: 12 };
const GOAL: Rect = { x: 580, y: LEDGE.y - 60, width: 40, height: 60 };
const GAP: Rect = { x: 300, y: GROUND_Y, width: 200, height: 40 };

const solid = (rect: Rect) => ({ rect, material: "marker" as const });

const room = (
  solids: readonly Rect[],
  goal: Rect | undefined,
  spawnX: number,
): BoardDefinition => ({
  id: "party-room",
  title: "Party room",
  spawn: { x: spawnX, y: GROUND_Y },
  killY: 1000,
  solids: solids.map(solid),
  zones: [],
  noInkZones: [],
  ...(goal === undefined ? {} : { goal }),
});

const ladderRoom = room([{ x: 0, y: GROUND_Y, width: 1200, height: 40 }, LEDGE], GOAL, 250);
const gapRoom = room(
  [
    { x: 0, y: GROUND_Y, width: GAP.x, height: 40 },
    { x: GAP.x + GAP.width, y: GROUND_Y, width: 700, height: 40 },
  ],
  { x: 800, y: GROUND_Y - 60, width: 40, height: 60 },
  100,
);
const meadow = room([{ x: -2000, y: GROUND_Y, width: 4000, height: 40 }], undefined, 100);

const ladder = (name: string, x: number): Drawing =>
  drawingOf(name, line({ x, y: GROUND_Y }, { x, y: LEDGE.y - 30 }));

class Table {
  private readonly ruled = new Map<string, { drawing: Drawing; nature: Nature }>();

  constructor(private readonly sim: Simulation) {}

  draw(drawing: Drawing, nature: Nature): void {
    this.sim.addDrawing(drawing);
    this.sim.applyRuling(drawing.id, rulingOf(nature));
    this.ruled.set(drawing.id, { drawing, nature });
  }

  erase(name: string): void {
    this.sim.removeDrawing(idOf(name));
    this.ruled.delete(name);
  }

  page(board: BoardDefinition): Page {
    const world = this.sim.snapshot();
    const inks: SceneInk[] = world.drawings.flatMap(({ id, pose }) => {
      const ink = this.ruled.get(id);
      return ink === undefined ? [] : [{ ...ink, pose, strength: 1 }];
    });
    return {
      board,
      inks,
      bites: world.bites,
      sumikui: world.sumikui,
      keyTaken: world.keyTaken,
      doorOpen: world.doorOpen,
      canFly: this.sim.canFly(),
      bounceArc: (strength) => this.sim.bounceArc(strength),
    };
  }
}

const centreX = (sim: Simulation, who: AliceIndex): number => {
  const { x, width } = sim.aliceBounds(who);
  return x + width / 2;
};

const twinsOf = (board: BoardDefinition): { sim: Simulation; table: Table; party: Party } => {
  const sim = enter(board);
  sim.setPhysics({ ...EARTH, clones: 1 });
  runSteps(sim, 30);
  return { sim, table: new Table(sim), party: new Party(createAutopilot) };
};

const walkTwinTo = (sim: Simulation, x: number): void => {
  sim.setWalkIntent(RIGHT, 1);
  runUntil(sim, () => centreX(sim, 1) > x, 1200);
  sim.setWalkIntent(STAY, 1);
  runSteps(sim, 30);
};

interface Outing {
  readonly events: readonly SimEvent[];
  readonly stuck: readonly AliceIndex[];
}

const outing = (
  { sim, table, party }: ReturnType<typeof twinsOf>,
  board: BoardDefinition,
  steps: number,
  done: (events: readonly SimEvent[]) => boolean = () => false,
  watch: (sim: Simulation) => void = () => {},
): Outing => {
  const events: SimEvent[] = [];
  const stuck: AliceIndex[] = [];
  for (let step = 0; step < steps && !done(events); step++) {
    for (const { who, kind } of party.drive(sim, table.page(board), true)) {
      if (kind === "stuck") stuck.push(who);
    }
    events.push(...sim.step());
    watch(sim);
  }
  return { events, stuck };
};

const goalsIn = (events: readonly SimEvent[]): readonly AliceIndex[] =>
  events.flatMap((event) => (event.type === "goal-reached" ? [event.who] : []));

describe("Party", () => {
  it("lets two Alices reach one goal up different drawn ladders", () => {
    const crew = twinsOf(ladderRoom);
    const { sim, table } = crew;
    walkTwinTo(sim, LEDGE.x + LEDGE.width + 150);
    table.draw(ladder("left", LEDGE.x - 12), "climbable");
    table.draw(ladder("right", LEDGE.x + LEDGE.width + 12), "climbable");

    const firstClimbAt = new Map<AliceIndex, number>();
    const { events } = outing(
      crew,
      ladderRoom,
      2400,
      (seen) => new Set(goalsIn(seen)).size === 2,
      (world) => {
        for (const [who, alice] of world.alices().entries()) {
          if (alice.climbing && !firstClimbAt.has(who)) firstClimbAt.set(who, alice.center.x);
        }
      },
    );

    expect(new Set(goalsIn(events))).toEqual(new Set([0, 1]));
    expect(firstClimbAt.get(0)).toBeLessThan(LEDGE.x);
    expect(firstClimbAt.get(1)).toBeGreaterThan(LEDGE.x + LEDGE.width);
  });

  it("does not let one Alice stuck at a gap stall the other on her way to the goal", () => {
    const crew = twinsOf(gapRoom);
    const { sim, table, party } = crew;
    table.draw(
      drawingOf(
        "plank",
        line({ x: GAP.x - 20, y: GROUND_Y - 4 }, { x: GAP.x + GAP.width + 20, y: GROUND_Y - 4 }),
      ),
      "solid",
    );
    walkTwinTo(sim, GAP.x + GAP.width + 80);
    table.erase("plank");
    party.invalidate();

    const { events, stuck } = outing(crew, gapRoom, 900, (seen) => goalsIn(seen).length > 0);

    expect(goalsIn(events)).toEqual([1]);
    expect(stuck).toEqual([0]);
    expect(centreX(sim, 0)).toBeLessThan(GAP.x);
  });

  it("steers only the selected Alice and leaves the rest to their own minds", () => {
    const crew = twinsOf(meadow);
    const { sim, party } = crew;
    const before = [centreX(sim, 0), centreX(sim, 1)];

    party.select(1);
    party.steer(LEFT);
    outing(crew, meadow, 60);

    expect(party.selected).toBe(1);
    expect(centreX(sim, 1) - (before[1] ?? 0)).toBeLessThan(-50);
    expect(Math.abs(centreX(sim, 0) - (before[0] ?? 0))).toBeLessThan(1);
  });

  it("hands a released Alice back to her pilot, who wanders when there is nothing to go for", () => {
    const crew = twinsOf(meadow);
    const { sim, party } = crew;
    party.select(1);
    party.steer(RIGHT);
    outing(crew, meadow, 30);
    party.steer(STAY);
    const released = centreX(sim, 1);
    const herself = centreX(sim, 0);

    outing(crew, meadow, 120);

    expect(Math.abs(centreX(sim, 1) - released)).toBeGreaterThan(50);
    expect(Math.abs(centreX(sim, 0) - herself)).toBeLessThan(1);
  });

  it("parks every Alice but the steered one while self-driving is switched off", () => {
    const { sim, table, party } = twinsOf(meadow);
    const before = [centreX(sim, 0), centreX(sim, 1)];
    party.steer(RIGHT);
    for (let step = 0; step < 60; step++) {
      party.drive(sim, table.page(meadow), false);
      sim.step();
    }
    expect(centreX(sim, 0) - (before[0] ?? 0)).toBeGreaterThan(50);
    expect(Math.abs(centreX(sim, 1) - (before[1] ?? 0))).toBeLessThan(1);
  });

  it("picks the Alice under a tap and falls back to Alice herself when her twin is dismissed", () => {
    const crew = twinsOf(meadow);
    const { sim, party } = crew;
    const alices = sim.alices();
    const twin = alices[1];
    if (twin === undefined) throw new Error("no twin");

    expect(party.aliceAt(twin.center, alices)).toBe(1);
    expect(party.aliceAt({ x: twin.center.x + 400, y: twin.center.y }, alices)).toBeNull();

    party.select(1);
    sim.setPhysics(EARTH);
    outing(crew, meadow, 1);
    expect(party.selected).toBe(0);
  });
});
