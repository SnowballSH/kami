import {
  distance,
  type PenPoint,
  type Stroke,
  strokeLength,
  strokesLength,
} from "../core/geometry";
import { INPUT_LIMITS, isInputPoint } from "../core/inputLimits";
import { InkLedger } from "./budget";
import { COMMIT_DELAY_MS, MIN_DRAWING_LENGTH } from "./constants";
import { DrawingIdSequence } from "./ids";
import { judgePlacement } from "./placement";
import { nextInkPoint } from "./stroke";
import type {
  InkBudget,
  InkSession,
  InkSessionListener,
  PlacementRejection,
  PlacementRules,
  PlacementVerdict,
} from "./types";

export class PenInkSession implements InkSession {
  readonly #listener: InkSessionListener;
  readonly #ledger = new InkLedger();
  readonly #ids = new DrawingIdSequence();
  #strokes: PenPoint[][] = [];
  #points = 0;
  #penIsDown = false;
  #liftedAtMs: number | null = null;
  #verdict: PlacementVerdict = "ok";

  constructor(listener: InkSessionListener) {
    this.#listener = listener;
  }

  get isDrawing(): boolean {
    return this.#penIsDown || this.#strokes.length > 0;
  }

  get activeStrokes(): readonly Stroke[] {
    return this.#strokes;
  }

  get activeVerdict(): PlacementVerdict {
    return this.#verdict;
  }

  get budget(): InkBudget {
    return this.#ledger.budget;
  }

  penDown(point: PenPoint): void {
    if (this.#penIsDown || this.#ledger.isDry) return;
    if (!isInputPoint(point)) {
      this.#reject("out-of-bounds");
      return;
    }
    if (this.#strokes.length >= INPUT_LIMITS.strokes || this.#points >= INPUT_LIMITS.points) {
      this.#reject("too-detailed");
      return;
    }
    this.#penIsDown = true;
    this.#strokes.push([point]);
    this.#points += 1;
  }

  penMove(point: PenPoint): void {
    const stroke = this.#strokes.at(-1);
    const last = stroke?.at(-1);
    if (!this.#penIsDown || stroke === undefined || last === undefined) return;
    if (!isInputPoint(point)) {
      this.#reject("out-of-bounds");
      return;
    }
    const next = nextInkPoint(last, point, this.#ledger.remaining);
    if (next === null) return;
    if (stroke.length >= INPUT_LIMITS.pointsPerStroke || this.#points >= INPUT_LIMITS.points) {
      this.#reject("too-detailed");
      return;
    }
    stroke.push(next);
    this.#points += 1;
    this.#ledger.draw(distance(last, next));
  }

  penUp(): void {
    if (!this.#penIsDown) return;
    this.#penIsDown = false;
    this.#liftedAtMs = null;
  }

  penCancel(): void {
    if (!this.#penIsDown) return;
    this.#penIsDown = false;
    const cancelled = this.#strokes.pop() ?? [];
    this.#points -= cancelled.length;
    this.#ledger.undraw(strokeLength(cancelled));
  }

  update(nowMs: number, rules: PlacementRules): void {
    this.#verdict = judgePlacement(this.#strokes, rules);
    if (this.#penIsDown || this.#strokes.length === 0) return;
    this.#liftedAtMs ??= nowMs;
    if (nowMs - this.#liftedAtMs >= COMMIT_DELAY_MS) this.#settle();
  }

  refund(cost: number): void {
    this.#ledger.refund(cost);
  }

  reset(totalInk: number): void {
    this.#dropPending();
    this.#ledger.refill(totalInk);
  }

  #settle(): void {
    const strokes = this.#strokes;
    const verdict = this.#verdict;
    const cost = strokesLength(strokes);
    this.#dropPending();
    if (cost < MIN_DRAWING_LENGTH) return;
    if (verdict !== "ok") {
      this.#listener.onReject(verdict, strokes);
      return;
    }
    this.#ledger.spend(cost);
    this.#listener.onCommit({ id: this.#ids.next(), strokes, cost });
  }

  #dropPending(): void {
    this.#strokes = [];
    this.#points = 0;
    this.#penIsDown = false;
    this.#liftedAtMs = null;
    this.#verdict = "ok";
    this.#ledger.dropPending();
  }

  #reject(reason: PlacementRejection): void {
    this.#dropPending();
    this.#listener.onReject(reason, []);
  }
}
