import type { GameMode, GameModeId } from "./types";

export const EMBODIED_MODE_ID = "embodied" as GameModeId;
export const SPIRIT_MODE_ID = "spirit" as GameModeId;
export const BOSS_MODE_ID = "boss" as GameModeId;

/** What a drawing may be called to become her body; any body noun works too (`bodyNames.ts`). */
export const BODY_NAMES: readonly string[] = ["alice", "her", "me"];

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
 * The player opens the room as a spirit: no Alice, only a hand. They draw her and name the
 * drawing, and it becomes her body; lose the body and they are a spirit again.
 */
export const SPIRIT_MODE: GameMode = {
  id: SPIRIT_MODE_ID,
  card: {
    title: "Spirit",
    tagline: "There is no Alice. Draw one.",
    opening: "Nobody is here yet. Draw someone, and write who they are.",
  },
  opening: { player: "spirit", incarnation: { kind: "drawn", names: BODY_NAMES } },
  win: { kind: "reach-goal" },
  loss: { kind: "unmade" },
  laws: { kind: "except", dials: ["clones"] },
  natures: "all",
  autopilot: "forbidden",
};

/**
 * Two players. One draws a body around the soul and keeps redrawing what gets snipped off; the
 * other steers it. A servant of the one under the page comes through a tear to cut the body apart;
 * hurt it until the tear closes. The heart swallowed is the room over (docs/boss.md).
 */
export const BOSS_MODE: GameMode = {
  id: BOSS_MODE_ID,
  card: {
    title: "Boss",
    tagline: "A soul with no body, and something coming to snip it.",
    opening: "Only a heart, so far. Draw it a body, and name it. Quickly — it is coming.",
    roles: [
      "Drawer: draw a body around the heart, name it, and redraw whatever gets snipped off.",
      "Player: steer with the keys, the thumbstick or the joystick; dodge the wind-up, swing what is drawn.",
    ],
  },
  opening: { player: "spirit", incarnation: { kind: "drawn", names: BODY_NAMES } },
  win: { kind: "defeat-foe" },
  loss: { kind: "board-restarts" },
  laws: { kind: "except", dials: ["clones", "inkEater"] },
  natures: "all",
  autopilot: "forbidden",
};

export const GAME_MODES: readonly GameMode[] = [EMBODIED_MODE, SPIRIT_MODE, BOSS_MODE];

export const modeFor = (id: string): GameMode =>
  GAME_MODES.find((mode) => mode.id === id) ?? EMBODIED_MODE;
