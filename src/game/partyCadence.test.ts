import { describe, expect, it } from "vitest";
import { createAutopilot } from "../autopilot";
import type { Cadence, PilotOptions } from "../autopilot/types";
import type { BoardDefinition } from "../board/types";
import type { Rect } from "../core/geometry";
import { FIXED_STEP_MS } from "../core/world";
import { EARTH } from "../rules/types";
import { enter, runSteps } from "../sim/testSupport";
import { type Page, Party } from "./party";

const GROUND_Y = 400;
const TWINS = 2;
const TICKS = 1200;

const solid = (rect: Rect) => ({ rect, material: "marker" as const });

const ledge: BoardDefinition = {
  id: "cadence-room",
  title: "Cadence room",
  spawn: { x: 100, y: GROUND_Y },
  killY: 1000,
  solids: [
    solid({ x: 0, y: GROUND_Y, width: 600, height: 40 }),
    solid({ x: 900, y: GROUND_Y, width: 600, height: 40 }),
  ],
  zones: [],
  noInkZones: [],
  goal: { x: 1200, y: GROUND_Y - 60, width: 40, height: 60 },
};

interface Look {
  readonly who: number;
  readonly tick: number;
}

describe("Party cadence", () => {
  it("never lets two pilots take a routine re-plan on the same tick", () => {
    const sim = enter(ledge);
    sim.setPhysics({ ...EARTH, clones: TWINS });
    runSteps(sim, 30);
    let tick = 0;
    const routine: Look[] = [];
    const charted: Look[] = [];
    const watched = (who: number, cadence: Cadence | undefined): Cadence => ({
      mayReplan: () => {
        const granted = cadence?.mayReplan() ?? true;
        if (granted) routine.push({ who, tick });
        return granted;
      },
    });
    const hire = (options: PilotOptions) =>
      createAutopilot({
        ...options,
        cadence: watched(options.seed, options.cadence),
        charter: (scene) => {
          charted.push({ who: options.seed, tick });
          return options.charter(scene);
        },
      });
    const party = new Party(hire);
    const page = (): Page => {
      const world = sim.snapshot();
      return {
        board: ledge,
        inks: [],
        bites: world.bites,
        sumikui: world.sumikui,
        keyTaken: world.keyTaken,
        doorOpen: world.doorOpen,
        canFly: sim.canFly(),
        bounceArc: (strength) => sim.bounceArc(strength),
      };
    };
    for (; tick < TICKS; tick++) {
      party.drive(sim, page(), true, tick * FIXED_STEP_MS);
      sim.step();
    }

    const pilots = TWINS + 1;
    const ticksOf = (looks: readonly Look[]) => new Set(looks.map((look) => look.tick));
    expect(sim.alices()).toHaveLength(pilots);
    expect(ticksOf(routine).size).toBe(routine.length);
    for (let who = 0; who < pilots; who++) {
      expect(routine.filter((look) => look.who === who).length).toBeGreaterThanOrEqual(3);
    }
    const lookers = new Map<number, Set<number>>();
    for (const { who, tick: at } of charted)
      lookers.set(at, (lookers.get(at) ?? new Set()).add(who));
    const crowded = [...lookers].filter(([at, who]) => at > 0 && who.size > 1);
    expect(crowded).toEqual([]);
  });
});
