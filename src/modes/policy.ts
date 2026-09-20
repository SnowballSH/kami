import type { AllowedNatures, Nature } from "../cat/types";
import type { Governs } from "../rules/types";
import type { GameMode, LawPolicy } from "./types";

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

/** Whether the mode ever puts an Alice on the board without the player drawing her. */
export const opensWithAlice = (mode: GameMode): boolean =>
  mode.opening.player === "body" || mode.opening.incarnation.kind === "born";
