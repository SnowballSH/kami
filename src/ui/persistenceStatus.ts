import type { PersistenceState } from "../persistence/types";
import { el } from "./dom";
import { activateOnTap } from "./tap";

export class PersistenceStatus {
  private readonly label = el("span", {
    attrs: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
  });
  private readonly retry = el("button", {
    className: "kami-control",
    text: "Retry",
    attrs: { type: "button", "aria-label": "Retry board persistence" },
  });
  readonly element = el("div", { className: "kami-persistence" }, [this.label, this.retry]);

  constructor(onRetry: () => void) {
    this.retry.hidden = true;
    activateOnTap(this.retry, () => {
      if (!this.retry.disabled && !this.retry.hidden) onRetry();
    });
  }

  show(state: PersistenceState): void {
    const failedLoad = state.errors.some(({ operation }) => operation === "load");
    const message = [
      state.loading ? "Loading board…" : failedLoad ? "Saved board unavailable." : "",
      state.saving
        ? "Saving…"
        : state.unsaved > 0
          ? "Unsaved changes — keep this tab open."
          : state.errors.some(({ operation }) => operation === "list")
            ? "Board list unavailable."
            : !failedLoad && !state.loading
              ? "Saved"
              : "",
    ]
      .filter(Boolean)
      .join(" ");
    if (this.label.textContent !== message) this.label.textContent = message;
    this.retry.hidden = state.errors.length === 0 && state.unsaved === 0;
    this.retry.disabled = state.loading || state.saving;
  }
}
