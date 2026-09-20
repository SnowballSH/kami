import type { GameMode, GameModeId } from "./types";

export const EMBODIED_MODE_ID = "embodied" as GameModeId;
export const SPIRIT_MODE_ID = "spirit" as GameModeId;

/** Play as it is today: Alice stands at the spawn, walks herself or is steered, and falls back to her checkpoint. */
export const EMBODIED_MODE: GameMode = {
  id: EMBODIED_MODE_ID,
  card: {
    title: "Alice",
    tagline: "Alice can hop, not fly. You can draw.",
    opening: "She is waiting. Draw her a way.",
  },
  opening: { player: "body" },
  win: { kind: "reach-goal" },
  loss: { kind: "respawn" },
  laws: { kind: "all" },
  natures: "all",
  autopilot: "allowed",
};

/**
 * Not yet playable. The player opens the room as a spirit: no Alice, only a hand. They draw her and
 * name the drawing, and it becomes her body; lose the body and they are a spirit again.
 */
export const SPIRIT_MODE: GameMode = {
  id: SPIRIT_MODE_ID,
  card: {
    title: "Spirit",
    tagline: "There is no Alice. Draw one.",
    opening: "Nobody is here yet. Draw someone, and write who they are.",
  },
  opening: { player: "spirit", incarnation: { kind: "drawn", names: ["alice", "her", "me"] } },
  win: { kind: "reach-goal" },
  loss: { kind: "unmade" },
  laws: { kind: "except", dials: ["clones"] },
  natures: "all",
  autopilot: "forbidden",
};

export const GAME_MODES: readonly GameMode[] = [EMBODIED_MODE, SPIRIT_MODE];

export const modeFor = (id: string): GameMode =>
  GAME_MODES.find((mode) => mode.id === id) ?? EMBODIED_MODE;
