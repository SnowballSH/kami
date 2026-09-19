import { distance, type Stroke, strokesLength, type Vec } from "../core/geometry";
import { InkLedger } from "./budget";
import { COMMIT_DELAY_MS, MIN_DRAWING_LENGTH } from "./constants";
import { pageDrawingIds } from "./ids";
import { judgePlacement } from "./placement";
import { nextInkPoint } from "./stroke";
import type {
  InkBudget,
  InkGrant,
  InkSession,
  InkSessionListener,
  PlacementRules,
  PlacementVerdict,
} from "./types";

export class PenInkSession implements InkSession {
  readonly #listener: InkSessionListener;
  readonly #ledger = new InkLedger();
  #strokes: Vec[][] = [];
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

  penDown(point: Vec): void {
    if (this.#penIsDown || this.#ledger.isDry) return;
    this.#penIsDown = true;
    this.#liftedAtMs = null;
    this.#strokes.push([point]);
  }

  penMove(point: Vec): void {
    const stroke = this.#strokes.at(-1);
    const last = stroke?.at(-1);
    if (!this.#penIsDown || stroke === undefined || last === undefined) return;
    const next = nextInkPoint(last, point, this.#ledger.remaining);
    if (next === null) return;
    stroke.push(next);
    this.#ledger.draw(distance(last, next));
  }

  penUp(): void {
    this.#penIsDown = false;
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

  grant(grant: InkGrant): void {
    this.#ledger.grant(grant);
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
      this.#listener.onReject(verdict);
      return;
    }
    this.#ledger.spend(cost);
    this.#listener.onCommit({ id: pageDrawingIds.next(), strokes, cost });
  }

  #dropPending(): void {
    this.#strokes = [];
    this.#penIsDown = false;
    this.#liftedAtMs = null;
    this.#verdict = "ok";
    this.#ledger.dropPending();
  }
}
