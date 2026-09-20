import type { AllowedNatures, Nature } from "../cat/types";
import type { Governs } from "../rules/types";
import type { SimEvent } from "../sim/types";
import type { GameMode, LawPolicy, WinRule } from "./types";

export const allowsLaw = (policy: LawPolicy, dial: Governs): boolean => {
  switch (policy.kind) {
    case "all":
      return true;
    case "only":
      return policy.dials.includes(dial);
    case "except":
      return !policy.dials.includes(dial);
  }
};

/** The natures a room allows under a mode: the room's own list, narrowed by the mode's. */
export const naturesAllowed = (mode: GameMode, room: AllowedNatures): AllowedNatures => {
  if (mode.natures === "all") return room;
  if (room === "all") return mode.natures;
  const modeAllows = new Set<Nature>(mode.natures);
  return room.filter((nature) => modeAllows.has(nature));
};

/** Whether this event wins the room under the rule; `outlast` is judged on the clock, not on events. */
export const wonBy = (rule: WinRule, event: SimEvent): boolean => {
  switch (rule.kind) {
    case "reach-goal":
      return event.type === "goal-reached";
    case "defeat-foe":
      return event.type === "tear-closed";
    case "endless":
    case "outlast":
      return false;
  }
};

/** Kami's line when a law turns a dial the mode forbids: the mode's own, or `stock`. */
export const refusalLine = (mode: GameMode, dial: Governs, stock: string): string =>
  mode.refusals?.[dial] ?? stock;

/** Whether the mode ever puts an Alice on the board without the player drawing her. */
export const opensWithAlice = (mode: GameMode): boolean =>
  mode.opening.player === "body" || mode.opening.incarnation.kind === "born";
