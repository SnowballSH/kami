import type { Detach } from "../ui/types";

export interface BoothTarget {
  start(nowMs: number): void;
  jumpToRoom(index: number): void;
}

const RESET_KEY = "0";

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

/** Spec §9 booth mode: number keys jump to a room, 0 resets everything for the next judge. */
export function attachBoothKeys(target: BoothTarget, roomCount: number): Detach {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === RESET_KEY) {
      target.start(performance.now());
      return;
    }
    const room = Number.parseInt(event.key, 10);
    if (room >= 1 && room <= roomCount) target.jumpToRoom(room - 1);
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
