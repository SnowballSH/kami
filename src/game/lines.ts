import type { PlacementRejection } from "../ink/types";
import type { TitleCard } from "../ui/types";

export const REJECTION_LINES: Readonly<Record<PlacementRejection, string>> = {
  "no-ink-zone": "The Queen had that painted red. It won't take ink.",
  "overlaps-alice": "Not on Alice, if you please. Beside her.",
};

export const KEY_TAKEN_LINE = "A key! Now, whichever door could it be for?";
export const DOOR_OPENED_LINE = "Click. After you.";
export const GROW_BLOCKED_LINE = "No room to grow in here.";
export const UNNAMED_CAPTION = "just ink";

const CARD_MS = 2200;

export const GAME_TITLE_CARD: TitleCard = {
  title: "Kami",
  subtitle: "Draw it. Name it. It wakes up.",
  durationMs: 3200,
};

export const pageCard = (title: string, page: number): TitleCard => ({
  title,
  subtitle: `Page ${page}`,
  durationMs: CARD_MS,
});
