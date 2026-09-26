import { canonicalOf } from "../core/canonical";
import { same } from "../core/same";
import { PERSISTENCE_TIMEOUT_MS } from "../persistence/requestDeadline";
import { type BoardChange, type BoardEdit, storedEntitySchemas } from "./wire";

/**
 * How long after a write its echo is awaited. A write lands, or fails, within a few request deadlines
 * even queued behind others; one that failed never echoes, and must not hide the entity for good.
 */
export const ECHO_AWAITED_MS = 3 * PERSISTENCE_TIMEOUT_MS;

type Expected = (
  | { readonly type: "put"; readonly entity: unknown }
  | { readonly type: "delete" }
) & { readonly writtenAtMs: number };

const keyOf = (change: Exclude<BoardEdit, { readonly type: "clear" }>): string =>
  `${change.kind}/${change.id}`;

type Put = Extract<BoardEdit, { readonly type: "put" }>;

/** The entity as the server will echo it: what it stores, not what this device holds. */
const asEchoed = ({ kind, entity }: Put): unknown => canonicalOf(storedEntitySchemas[kind], entity);

/**
 * This device's writes to a shared page that the server has yet to echo back. Until the echo of its
 * latest write to an entity arrives, whatever else arrives about that entity is older news than what
 * the board already shows, and is passed over: a drawing erased here does not come back on the late
 * echo of its drawing, and the late echo of a clear does not wipe what was drawn since. The echo
 * itself is passed over too, since it is already on the board. Until the echo of its own clear
 * arrives, nothing else is taken either: whatever the server relays before that echo it put before
 * the clear, so it is already wiped from this board.
 *
 * The server orders writes, so everything relayed about an entity after this device's write lands
 * after it on the server as well, and applies as usual. An echo not heard within `ECHO_AWAITED_MS` is
 * no longer awaited.
 */
export class LocalEdits {
  readonly #expected = new Map<string, Expected>();
  /** When each clear whose echo is awaited was written, oldest first. */
  readonly #clears: number[] = [];

  constructor(private readonly now: () => number = () => performance.now()) {}

  wrote(edit: BoardEdit): void {
    const writtenAtMs = this.now();
    switch (edit.type) {
      case "clear":
        this.#expected.clear();
        this.#clears.push(writtenAtMs);
        return;
      case "put":
        this.#expected.set(keyOf(edit), {
          type: "put",
          entity: asEchoed(edit),
          writtenAtMs,
        });
        return;
      case "delete":
        this.#expected.set(keyOf(edit), { type: "delete", writtenAtMs });
        return;
    }
  }

  /** Whether a relayed change should land on the board. */
  admits(change: BoardChange): boolean {
    this.#forgetUnechoed();
    if (change.type === "clear") {
      if (this.#clears.length > 0) {
        this.#clears.shift();
        return false;
      }
      this.#expected.clear();
      return true;
    }
    const key = keyOf(change);
    const expected = this.#expected.get(key);
    if (expected === undefined) return this.#clears.length === 0;
    const echo =
      expected.type === change.type &&
      (change.type === "delete" ||
        (expected.type === "put" && same(expected.entity, change.entity)));
    if (echo) this.#expected.delete(key);
    return false;
  }

  get pending(): number {
    this.#forgetUnechoed();
    return this.#expected.size + this.#clears.length;
  }

  #forgetUnechoed(): void {
    const oldestAwaitedMs = this.now() - ECHO_AWAITED_MS;
    for (const [key, { writtenAtMs }] of this.#expected)
      if (writtenAtMs <= oldestAwaitedMs) this.#expected.delete(key);
    while ((this.#clears[0] ?? Number.POSITIVE_INFINITY) <= oldestAwaitedMs) this.#clears.shift();
  }
}
