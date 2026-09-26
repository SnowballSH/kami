import { describe, expect, it } from "vitest";
import type { PersistenceState } from "../persistence/types";
import { PersistenceStatus } from "./persistenceStatus";

const failing = (): PersistenceState => ({
  loading: false,
  saving: false,
  unsaved: 2,
  errors: [{ operation: "save", reason: "http", status: 503 }],
});

const mutationsDuring = (status: PersistenceStatus, show: () => void): number => {
  const observer = new MutationObserver(() => {});
  observer.observe(status.element, {
    subtree: true,
    attributes: true,
    childList: true,
    characterData: true,
  });
  show();
  const records = observer.takeRecords();
  observer.disconnect();
  return records.length;
};

describe("PersistenceStatus", () => {
  it("leaves the page alone when an equal state is shown again", () => {
    const status = new PersistenceStatus(() => {});
    const retrying = (): PersistenceState => ({ ...failing(), saving: true });
    status.show(retrying());

    expect(mutationsDuring(status, () => status.show(retrying()))).toBe(0);
  });

  it("updates when any field of the state changes", () => {
    const status = new PersistenceStatus(() => {});
    status.show(failing());

    status.show({ ...failing(), saving: true });
    const label = status.element.querySelector("[role='status']");
    const retry = status.element.querySelector("button");

    expect(label?.textContent).toBe("Saving…");
    expect(retry?.disabled).toBe(true);
    status.show({ ...failing(), errors: [{ operation: "save", reason: "timeout" }] });
    expect(retry?.disabled).toBe(false);
  });

  it("shows that nothing is kept, once, for a store that forgets", () => {
    const status = new PersistenceStatus(() => {});
    status.show(null);

    expect(status.element.querySelector("[role='status']")?.textContent).toBe("Not saved");
    expect(mutationsDuring(status, () => status.show(null))).toBe(0);
  });
});
