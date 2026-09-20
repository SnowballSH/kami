import { Chart } from "../autopilot/chart";
import type { Autopilot, PilotOptions, Scene, SceneInk } from "../autopilot/types";
import type { BoardDefinition } from "../board/types";
import type { Rect, Vec } from "../core/geometry";
import {
  ALICE_HERSELF,
  type AliceIndex,
  type AliceSnapshot,
  type BounceArc,
  type Simulation,
  type SumikuiSnapshot,
  type WalkIntent,
} from "../sim/types";

const IDLE: WalkIntent = { x: 0, y: 0 };

/** What every Alice sees alike this step: the page, as opposed to herself. */
export interface Page {
  readonly board: BoardDefinition;
  readonly inks: readonly SceneInk[];
  readonly bites: readonly Rect[];
  readonly sumikui: SumikuiSnapshot | null;
  readonly keyTaken: boolean;
  readonly doorOpen: boolean;
  readonly canFly: boolean;
  readonly bounceArc: (strength: number) => BounceArc;
}

export type Hire = (options: PilotOptions) => Autopilot;

/** Something that has just now become true of one Alice's mind, worth a word from Kami. */
export interface News {
  readonly who: AliceIndex;
  readonly kind: "stuck" | "flees" | "cornered";
}

const boundsOf = (alice: AliceSnapshot): Rect => ({
  x: alice.center.x - alice.width / 2,
  y: alice.center.y - alice.height / 2,
  width: alice.width,
  height: alice.height,
});

const contains = (rect: Rect, point: Vec): boolean =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.width &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.height;

/**
 * Every Alice on the board and the mind behind each: Alice's own pilot first, then one hired per
 * twin. The player steers whichever is selected; the rest drive themselves. Within a step the
 * pilots share their charts, since none of them stamps an Alice and so all read the page alike.
 */
export class Party {
  private readonly pilots: Autopilot[] = [];
  private readonly charts = new Map<readonly SceneInk[], Chart | null>();
  private readonly wasStuck: boolean[] = [];
  private readonly wasFleeing: boolean[] = [];
  private chosen: AliceIndex = ALICE_HERSELF;
  private manual: WalkIntent = IDLE;

  constructor(private readonly hire: Hire) {
    this.match(1);
  }

  get selected(): AliceIndex {
    return this.chosen;
  }

  get manualIntent(): WalkIntent {
    return this.manual;
  }

  select(who: AliceIndex): void {
    this.chosen = who;
    this.manual = IDLE;
  }

  /** The Alice under `point`, Alice herself winning a tie, or null if the tap missed them all. */
  aliceAt(point: Vec, alices: readonly AliceSnapshot[]): AliceIndex | null {
    const hit = alices.findIndex((alice) => contains(boundsOf(alice), point));
    return hit < 0 ? null : hit;
  }

  steer(intent: WalkIntent): void {
    this.manual = intent;
    if (intent.x === 0 && intent.y === 0) this.pilots[this.chosen]?.invalidate();
  }

  reset(): void {
    this.wasStuck.length = 0;
    this.wasFleeing.length = 0;
    for (const pilot of this.pilots) pilot.reset();
  }

  invalidate(): void {
    for (const pilot of this.pilots) pilot.invalidate();
  }

  /**
   * Hands the sim one intent per Alice for this step: the player's for the selected one while
   * steering, each pilot's own otherwise. With self-driving switched off only the selected one
   * moves, and only under the player's hand. Returns who has just now run out of ideas, taken
   * flight from the Sumikui or been cornered by it, so Kami can say so.
   */
  drive(sim: Simulation, page: Page, selfDriving: boolean): readonly News[] {
    const alices = sim.alices();
    this.match(alices.length);
    this.charts.clear();
    const steered = this.manual.x !== 0 || this.manual.y !== 0;
    const news: News[] = [];
    for (const [who, alice] of alices.entries()) {
      const pilot = this.pilots[who];
      if (pilot === undefined) continue;
      if (who === this.chosen && (steered || !selfDriving)) {
        sim.setWalkIntent(this.manual, who);
        continue;
      }
      if (!selfDriving) {
        sim.setWalkIntent(IDLE, who);
        continue;
      }
      sim.setWalkIntent(pilot.drive(this.scene(sim, page, alices, who, alice)), who);
      const { stuck, errand } = pilot.status;
      const fleeing = errand.kind === "flee";
      if (fleeing && this.wasFleeing[who] !== true) news.push({ who, kind: "flees" });
      if (stuck && this.wasStuck[who] !== true) {
        news.push({ who, kind: fleeing ? "cornered" : "stuck" });
      }
      this.wasFleeing[who] = fleeing;
      this.wasStuck[who] = stuck;
    }
    return news;
  }

  /** The roster changed (a clone law came or went): keep a mind per Alice and a selection that exists. */
  resync(count: number): void {
    this.match(count);
  }

  private match(count: number): void {
    while (this.pilots.length > count) this.pilots.pop();
    while (this.pilots.length < count) {
      const seed = this.pilots.length;
      const wanders = seed !== ALICE_HERSELF;
      this.pilots.push(this.hire({ seed, wanders, charter: (scene) => this.chart(scene) }));
    }
    if (this.chosen >= count) this.select(ALICE_HERSELF);
  }

  private chart(scene: Scene): Chart | null {
    const seen = this.charts.get(scene.inks);
    if (seen !== undefined) return seen;
    const chart = Chart.of(scene);
    this.charts.set(scene.inks, chart);
    return chart;
  }

  private scene(
    sim: Simulation,
    page: Page,
    alices: readonly AliceSnapshot[],
    who: AliceIndex,
    alice: AliceSnapshot,
  ): Scene {
    return {
      ...page,
      alice,
      others: alices.filter((_, index) => index !== who),
      walkSpeed: sim.walkSpeed(who),
      jumpArc: sim.jumpArc(who),
    };
  }
}
