import { createAutopilot } from "../../autopilot";
import type { Scene, SceneInk } from "../../autopilot/types";
import { boardFor } from "../../board";
import type { BoardDefinition } from "../../board/types";
import { createCat } from "../../cat";
import type { Ruling } from "../../cat/types";
import type { Stroke, Vec } from "../../core/geometry";
import type { Drawing, DrawingId } from "../../ink/types";
import type { NoteId } from "../../notes/types";
import { createRuleCompiler, resolvePhysics } from "../../rules";
import type { Rule, RuleId, WorldPhysics } from "../../rules/types";
import { createSimulation } from "../../sim";
import { aliceOf, drawingOf, feetOf } from "../../sim/testSupport";
import type { SimEvent, WorldSnapshot } from "../../sim/types";
import { allowsLaw } from "../policy";
import type { RoomStaging } from "../types";
import { PUZZLE_MODE } from "./mode";
import { PuzzleDirector } from "./puzzleDirector";

const MAX_STEPS = 4_000;

interface Inked {
  readonly drawing: Drawing;
  readonly ruling: Ruling | null;
}

export type Done = (run: PuzzleRun, events: readonly SimEvent[]) => boolean;

/**
 * One puzzle room played the way the game plays it, without the game: the room's staged world under
 * the player's laws, the Cat ruling on names under the room's natures, and Alice walking herself.
 */
export class PuzzleRun {
  readonly board: BoardDefinition;
  readonly staging: RoomStaging;
  readonly sim = createSimulation();
  readonly pilot = createAutopilot();
  readonly seen: SimEvent[] = [];
  private readonly cat = createCat();
  private readonly compiler = createRuleCompiler();
  private readonly inks = new Map<DrawingId, Inked>();
  private readonly rules: Rule[] = [];
  private written = 0;

  constructor(boardId: string) {
    this.board = boardFor(boardId);
    const director = new PuzzleDirector(PUZZLE_MODE);
    this.sim.loadBoard(this.board);
    director.open(this.board);
    if (director.room === null) throw new Error(`${boardId} is not a puzzle room`);
    this.staging = director.room;
    const [zone] = this.board.zones;
    if (zone !== undefined) this.cat.enterRoom(zone);
    this.refold();
  }

  get physics(): WorldPhysics {
    return resolvePhysics(this.standingRules(), this.staging.world);
  }

  get world(): WorldSnapshot {
    return this.sim.snapshot();
  }

  get feet(): Vec {
    return feetOf(this.sim);
  }

  get won(): boolean {
    return this.seen.some((event) => event.type === "goal-reached");
  }

  has(id: string): boolean {
    return this.world.drawings.some((drawing) => drawing.id === id);
  }

  /** Ink laid down, and named if `utterance` says what it is; the Cat decides what the room lets it be. */
  async draw(
    name: string,
    utterance: string | null,
    ...strokes: readonly Stroke[]
  ): Promise<Ruling | null> {
    const drawing = drawingOf(name, ...strokes);
    this.sim.addDrawing(drawing);
    const ruling = utterance === null ? null : await this.cat.name(utterance, drawing);
    if (ruling !== null) this.sim.applyRuling(drawing.id, ruling);
    this.inks.set(drawing.id, { drawing, ruling });
    this.pilot.invalidate();
    return ruling;
  }

  /** A law written on the page; null when the grammar makes nothing of it. Folded only if the room allows the dial. */
  async write(text: string): Promise<Rule | null> {
    const compiled = await this.compiler.compile(text);
    if (compiled === null) return null;
    const rule: Rule = {
      ...compiled,
      id: `rule-${this.written}` as RuleId,
      sourceText: text,
      noteId: `note-${this.written}` as NoteId,
      position: { x: 0, y: 0 },
      createdAt: ++this.written,
    };
    this.rules.push(rule);
    this.refold();
    return rule;
  }

  erase(rule: Rule): void {
    const at = this.rules.indexOf(rule);
    if (at >= 0) this.rules.splice(at, 1);
    this.refold();
  }

  step(): readonly SimEvent[] {
    this.sim.setWalkIntent(this.pilot.drive(this.scene()));
    const events = this.sim.step();
    for (const event of events) this.note(event);
    this.seen.push(...events);
    return events;
  }

  run(steps: number): void {
    for (let step = 0; step < steps; step++) this.step();
  }

  until(done: Done, maxSteps = MAX_STEPS): boolean {
    for (let step = 0; step < maxSteps; step++) {
      if (done(this, this.seen)) return true;
      this.step();
    }
    return done(this, this.seen);
  }

  /** Walks her until the goal is reached, or gives up. */
  play(maxSteps = MAX_STEPS): boolean {
    return this.until((run) => run.won, maxSteps);
  }

  private standingRules(): readonly Rule[] {
    return this.rules.filter((rule) => allowsLaw(this.staging.laws, rule.effect.governs));
  }

  private refold(): void {
    this.sim.setPhysics(this.physics);
    this.pilot.invalidate();
  }

  private note(event: SimEvent): void {
    switch (event.type) {
      case "consumed":
      case "perished":
      case "devoured":
        this.inks.delete(event.drawingId);
        this.pilot.invalidate();
        return;
      case "warped":
      case "paper-bitten":
      case "paper-healed":
      case "alice-devoured":
        this.pilot.invalidate();
        return;
      default:
        return;
    }
  }

  private scene(): Scene {
    const { sim } = this;
    const world = sim.snapshot();
    return {
      board: this.board,
      alice: aliceOf(sim),
      others: [],
      sumikui: world.sumikui,
      inks: this.sceneInks(world),
      bites: world.bites,
      keyTaken: world.keyTaken,
      doorOpen: world.doorOpen,
      walkSpeed: sim.walkSpeed(),
      canFly: sim.canFly(),
      bounceArc: (strength) => sim.bounceArc(strength),
      jumpArc: sim.jumpArc(),
    };
  }

  private sceneInks(world: WorldSnapshot): readonly SceneInk[] {
    return world.drawings.flatMap(({ id, pose }) => {
      const inked = this.inks.get(id);
      if (inked === undefined) return [];
      return [
        {
          drawing: inked.drawing,
          pose,
          nature: inked.ruling?.nature ?? "ink",
          strength: inked.ruling?.strength ?? 1,
        },
      ];
    });
  }
}
