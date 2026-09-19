import { DRY_INK_EPSILON } from "./constants";
import type { InkBudget } from "./types";

export class InkLedger {
  #total = 0;
  #spent = 0;
  #pending = 0;

  get remaining(): number {
    const left = this.#total - this.#spent - this.#pending;
    return left < DRY_INK_EPSILON ? 0 : left;
  }

  get isDry(): boolean {
    return this.remaining === 0;
  }

  get budget(): InkBudget {
    return { total: this.#total, remaining: this.remaining };
  }

  draw(length: number): void {
    this.#pending += length;
  }

  dropPending(): void {
    this.#pending = 0;
  }

  spend(cost: number): void {
    this.#spent += cost;
  }

  refund(cost: number): void {
    this.#spent = Math.max(0, this.#spent - cost);
  }

  refill(total: number): void {
    this.#total = total;
    this.#spent = 0;
    this.#pending = 0;
  }
}
