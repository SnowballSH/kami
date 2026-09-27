import { clamp } from "../../core/geometry";
import type { DrawingId } from "../../ink/types";
import type { LiveRecognizer } from "../../recognition/types";
import type { GameClock } from "../context";
import type { InkLedger, InkRecord } from "../inkLedger";

export const DEFAULT_TIDINESS = 0.5;
const RETIDY_AFTER_MS = 350;
const MOST_RETIDIED = 12;

/**
 * Kami tidies what has just been named, once per drawing: the ink glides into the player's own
 * strokes, steadied, and whatever a finished drawing of it was missing is drawn in. Tidying always
 * starts from the strokes as drawn, so the slider can be moved back; the latest request for a
 * drawing wins.
 */
export class Tidier {
  private firmness: number;
  private readonly tidied = new Set<DrawingId>();
  private readonly turns = new Map<DrawingId, number>();
  private retidyDueAtMs: number | null = null;

  constructor(
    private readonly ledger: InkLedger,
    private readonly finisher: Pick<LiveRecognizer, "complete"> | null,
    private readonly clock: GameClock,
    private readonly save: (record: InkRecord) => void,
    tidiness = DEFAULT_TIDINESS,
  ) {
    this.firmness = clamp(tidiness, 0, 1);
  }

  get tidiness(): number {
    return this.firmness;
  }

  /** The slider moved: once it has rested a moment, what is already named is tidied again. */
  setTidiness(tidiness: number): number {
    this.firmness = clamp(tidiness, 0, 1);
    this.retidyDueAtMs = this.clock.nowMs + RETIDY_AFTER_MS;
    return this.firmness;
  }

  /** Kami's own drawings arrive finished. */
  alreadyTidy(id: DrawingId): void {
    this.tidied.add(id);
  }

  async tidy(id: DrawingId, name: string): Promise<void> {
    if (this.tidied.has(id) || this.firmness <= 0) return;
    this.tidied.add(id);
    await this.retidy(id, name);
  }

  frame(): void {
    if (this.retidyDueAtMs === null || this.clock.nowMs < this.retidyDueAtMs) return;
    this.retidyDueAtMs = null;
    for (const { drawing, ruling } of this.ledger.named().slice(-MOST_RETIDIED)) {
      if (ruling === null) continue;
      this.tidied.add(drawing.id);
      void this.retidy(drawing.id, ruling.name);
    }
  }

  clear(): void {
    this.tidied.clear();
    this.turns.clear();
    this.retidyDueAtMs = null;
  }

  private async retidy(id: DrawingId, name: string): Promise<void> {
    const before = this.ledger.get(id);
    if (this.finisher === null || before === null) return;
    const current = this.clock.pageGuard();
    const turn = (this.turns.get(id) ?? 0) + 1;
    this.turns.set(id, turn);
    const completion =
      this.firmness <= 0 ? null : await this.finisher.complete(before.drawn, name, this.firmness);
    const now = this.ledger.get(id);
    if (!current() || now === null || this.turns.get(id) !== turn) return;
    if (now.ruling !== before.ruling) {
      if (now.ruling !== null) await this.retidy(id, now.ruling.name);
      return;
    }
    if (completion === null && (this.firmness > 0 || now.drawing.strokes === now.drawn)) return;
    const strokes = completion === null ? now.drawn : [...completion.tidied, ...completion.added];
    const retraced = this.ledger.retrace(id, strokes, this.clock.nowMs);
    if (retraced !== null) this.save(retraced);
  }
}
