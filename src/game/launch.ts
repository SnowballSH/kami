import { DEMO_BOARD_ID } from "../board";
import {
  EMBODIED_MODE_ID,
  type GameMode,
  modeFor,
  PUZZLE_MODE_ID,
  puzzleBoardIdFor,
} from "../modes";

export const BOARD_PARAM = "board";
export const MODE_PARAM = "mode";

/** An endless page shared by everyone who opens it with no board of their own. */
export const SHARED_PAGE_ID = "sandbox";

/** `?mode=sandbox` or `?mode=puzzle` picks how the board is played; anything else, or nothing, is today's play. */
export const modeInUrl = (search: string): GameMode =>
  modeFor(new URLSearchParams(search).get(MODE_PARAM) ?? EMBODIED_MODE_ID);

/** The puzzle rooms play in order, from the first or from the `board` named; any other mode opens the board named, or its own default. */
export const boardInUrl = (search: string, mode: GameMode): string => {
  const requested = new URLSearchParams(search).get(BOARD_PARAM);
  if (mode.id === PUZZLE_MODE_ID) return puzzleBoardIdFor(requested);
  return requested ?? (mode.page === "endless" ? SHARED_PAGE_ID : DEMO_BOARD_ID);
};

/** The address another device opens to join this board in this mode. */
export const shareLink = (href: string, boardId: string, mode: GameMode): string => {
  const url = new URL(href);
  url.search = "";
  url.hash = "";
  url.searchParams.set(BOARD_PARAM, boardId);
  url.searchParams.set(MODE_PARAM, mode.id);
  return url.toString();
};
