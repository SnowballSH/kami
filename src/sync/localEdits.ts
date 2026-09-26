import { same } from "../core/same";
import type { BoardChange, BoardEdit } from "./wire";

type Expected = { readonly type: "put"; readonly entity: unknown } | { readonly type: "delete" };

const keyOf = (change: Exclude<BoardEdit, { readonly type: "clear" }>): string =>
  `${change.kind}/${change.id}`;

/** The entity as the server will echo it: through JSON, so `-0` and `undefined` fields compare as they will arrive. */
const asEchoed = (entity: unknown): unknown => JSON.parse(JSON.stringify(entity));

/**
 * This device's writes to a shared page that the server has yet to echo back. Until the echo of its
 * latest write to an entity arrives, whatever else arrives about that entity is older news than what
 * the board already shows, and is passed over: a drawing erased here does not come back on the late
 * echo of its drawing, and the late echo of a clear does not wipe what was drawn since. The echo
 * itself is passed over too, since it is already on the board.
 *
 * The server orders writes, so everything relayed about an entity after this device's write lands
 * after it on the server as well, and applies as usual.
 */
export class LocalEdits {
  readonly #expected = new Map<string, Expected>();
  #clears = 0;

  wrote(edit: BoardEdit): void {
    switch (edit.type) {
      case "clear":
        this.#expected.clear();
        this.#clears += 1;
        return;
      case "put":
        this.#expected.set(keyOf(edit), { type: "put", entity: asEchoed(edit.entity) });
        return;
      case "delete":
        this.#expected.set(keyOf(edit), { type: "delete" });
        return;
    }
  }

  /** Whether a relayed change should land on the board. */
  admits(change: BoardChange): boolean {
    if (change.type === "clear") {
      if (this.#clears > 0) {
        this.#clears -= 1;
        return false;
      }
      this.#expected.clear();
      return true;
    }
    const key = keyOf(change);
    const expected = this.#expected.get(key);
    if (expected === undefined) return true;
    const echo =
      expected.type === change.type &&
      (change.type === "delete" ||
        (expected.type === "put" && same(expected.entity, change.entity)));
    if (echo) this.#expected.delete(key);
    return false;
  }

  get pending(): number {
    return this.#expected.size + this.#clears;
  }
}
