import type { BoardStore } from "./types";

export const guardUnsavedChanges = (host: Window, store: BoardStore): (() => void) => {
  const warn = (event: BeforeUnloadEvent): void => {
    if (!store.hasUnsavedChanges) return;
    event.preventDefault();
    event.returnValue = "";
  };
  host.addEventListener("beforeunload", warn);
  return () => host.removeEventListener("beforeunload", warn);
};
