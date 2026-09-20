import type { GameMode, GameModeId } from "./types";

export const SANDBOX_MODE_ID = "sandbox" as GameModeId;

export const NOTHING_HUNGRY_LINE = "Nothing hungry lives on this page.";

/**
 * An endless page shared by everyone who opens it: no rabbit hole, no edges, no Sumikui. Alice
 * wanders toward whatever was drawn last; Kami helps only when asked.
 */
export const SANDBOX_MODE: GameMode = {
  id: SANDBOX_MODE_ID,
  card: {
    title: "Sandbox",
    tagline: "An endless page. Draw together.",
    opening: "The page goes on forever. Draw, and she will follow.",
  },
  opening: { player: "body", freshPage: false },
  win: { kind: "endless" },
  loss: { kind: "respawn" },
  laws: { kind: "except", dials: ["inkEater"] },
  natures: "all",
  autopilot: "allowed",
  page: "endless",
  help: "on-request",
  sharing: "live",
  refusals: { inkEater: NOTHING_HUNGRY_LINE },
};
