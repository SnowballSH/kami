import { clamp, type Vec } from "../../core/geometry";
import type { BodyPartKind, Cut } from "../body/types";
import { type Prey, Snipper, type SnipperSnapshot } from "./snipper";
import { type SnipperRank, TEAR_TUNING } from "./tuning";

export type TearPhase = "opening" | "open" | "closing" | "closed";

export interface CutMark {
  readonly cut: Cut;
  readonly ageMs: number;
  readonly landed: boolean;
}

export interface TearSnapshot {
  readonly at: Vec;
  readonly phase: TearPhase;
  readonly progress: number;
  /** The servant's health, 0 to 1; the lessers do not count. */
  readonly health: number;
  readonly snippers: readonly SnipperSnapshot[];
  readonly cuts: readonly CutMark[];
  readonly mercy: boolean;
  readonly wave: number;
}

export type TearDeed =
  | { readonly kind: "servant-came" }
  | {
      readonly kind: "cut";
      readonly cut: Cut;
      readonly part: BodyPartKind;
      readonly rank: SnipperRank;
    }
  | { readonly kind: "wave"; readonly lessers: number }
  | { readonly kind: "servant-perished"; readonly rank: SnipperRank }
  | { readonly kind: "closed" };

interface Mark {
  readonly cut: Cut;
  readonly atMs: number;
  landed: boolean;
}

const LESSER_SPREAD = Math.PI * 0.8;

/**
 * The rip in the page the servant comes through. It opens when the body is drawn, sends the
 * servant after a breath, sends lessers as the servant weakens, and closes when the servant is
 * unmade. It also keeps the mercy window: after a snip lands, no blade moves for a moment.
 */
export class Tear {
  private snippers: Snipper[] = [];
  private phase: TearPhase = "opening";
  private phaseSinceMs = 0;
  private clock = 0;
  private wavesSent = 0;
  private mercyUntilMs = 0;
  private marks: Mark[] = [];
  private servantHealth = 1;

  constructor(readonly at: Vec) {}

  get currentPhase(): TearPhase {
    return this.phase;
  }

  get inMercy(): boolean {
    return this.clock < this.mercyUntilMs;
  }

  get alive(): readonly Snipper[] {
    return this.snippers.filter((snipper) => !snipper.perished);
  }

  /** A snip landed: the blades pause so the drawer can answer. */
  landed(cut: Cut): void {
    this.mercyUntilMs = this.clock + TEAR_TUNING.mercyMs;
    const mark = this.marks.find((m) => m.cut === cut);
    if (mark !== undefined) mark.landed = true;
  }

  hurt(snipper: Snipper, damage: number, from: Vec): boolean {
    if (!this.snippers.includes(snipper)) return false;
    return snipper.hurt(damage, from);
  }

  tick(elapsedMs: number, prey: Prey | null): readonly TearDeed[] {
    this.clock += elapsedMs;
    this.marks = this.marks.filter((mark) => this.clock - mark.atMs < TEAR_TUNING.cutFlashMs);
    const deeds: TearDeed[] = [];
    switch (this.phase) {
      case "opening":
        if (this.clock - this.phaseSinceMs >= TEAR_TUNING.entryDelayMs) {
          this.snippers.push(new Snipper("servant", this.at, -Math.PI / 2));
          this.enter("open");
          deeds.push({ kind: "servant-came" });
        }
        return deeds;
      case "open": {
        const gone: Snipper[] = [];
        for (const snipper of this.snippers) {
          const deed = snipper.tick(elapsedMs, prey, this.inMercy);
          if (deed?.kind === "cut") {
            this.marks.push({ cut: deed.cut, atMs: this.clock, landed: false });
            deeds.push({ kind: "cut", cut: deed.cut, part: deed.part, rank: snipper.rank });
          }
          if (deed?.kind === "perished") {
            gone.push(snipper);
            deeds.push({ kind: "servant-perished", rank: snipper.rank });
          }
        }
        this.snippers = this.snippers.filter((snipper) => !gone.includes(snipper));
        const servant = this.servant();
        this.servantHealth = servant === null ? 0 : servant.health / servant.tuning.health;
        deeds.push(...this.sendWaves(prey));
        if (servant === null) {
          this.snippers = [];
          this.enter("closing");
        }
        return deeds;
      }
      case "closing":
        if (this.clock - this.phaseSinceMs >= TEAR_TUNING.closingMs) {
          this.enter("closed");
          deeds.push({ kind: "closed" });
        }
        return deeds;
      case "closed":
        return deeds;
    }
  }

  snapshot(): TearSnapshot {
    return {
      at: this.at,
      phase: this.phase,
      progress: this.progress(),
      health: this.servantHealth,
      snippers: this.snippers.map((snipper) => snipper.snapshot()),
      cuts: this.marks.map((mark) => ({
        cut: mark.cut,
        ageMs: this.clock - mark.atMs,
        landed: mark.landed,
      })),
      mercy: this.inMercy,
      wave: this.wavesSent,
    };
  }

  private servant(): Snipper | null {
    return this.snippers.find((snipper) => snipper.rank === "servant") ?? null;
  }

  private sendWaves(prey: Prey | null): readonly TearDeed[] {
    const wave = TEAR_TUNING.waves[this.wavesSent];
    if (wave === undefined || prey === null || this.servantHealth > wave.belowHealth) return [];
    this.wavesSent += 1;
    for (let i = 0; i < wave.lessers; i++) {
      const angle = -Math.PI / 2 + LESSER_SPREAD * (i - (wave.lessers - 1) / 2);
      this.snippers.push(new Snipper("lesser", this.at, angle));
    }
    return [{ kind: "wave", lessers: wave.lessers }];
  }

  private enter(phase: TearPhase): void {
    this.phase = phase;
    this.phaseSinceMs = this.clock;
  }

  private progress(): number {
    const since = this.clock - this.phaseSinceMs;
    switch (this.phase) {
      case "opening":
        return clamp(since / TEAR_TUNING.entryDelayMs, 0, 1);
      case "closing":
        return clamp(since / TEAR_TUNING.closingMs, 0, 1);
      case "open":
        return 1;
      case "closed":
        return 0;
    }
  }
}
