import type { RoomBrief } from "../cat/types";
import type { PlacementRejection } from "../ink/types";

export const WORDMARK = "kami";
export const TAGLINE = "draw it. name it. it wakes up.";

export const REJECTION_LINES: Readonly<Record<PlacementRejection, string>> = {
  "no-ink-zone": "That part's painted red. It won't take ink.",
  "overlaps-alice": "Not on Alice, if you please. Beside her.",
};

export const SHRUGS: readonly string[] = [
  "Hm. I can't make that true. Yet.",
  "Write it beside a drawing, or tell me a law of physics.",
  "Curious. But what should it do?",
];

export const KEY_TAKEN_LINE = "A key! Now, whichever door could it be for?";
export const DOOR_OPENED_LINE = "Click. After you.";
export const GROW_BLOCKED_LINE = "No room to grow in here.";
export const GOAL_LINE = "Down the rabbit hole. You drew your way here.";
export const RULE_REPEALED_LINE = "Struck from the laws of nature.";
export const OFFER_HELP_HINT = "(write 'help' anywhere)";

export const glossOf = (explanation: string): string => `= ${explanation}`;

const HELP_REQUEST = /^(help|hint|hints|stuck|i'?m stuck|i am stuck|\?+|what now|tell me)\b/i;

export const isHelpRequest = (text: string): boolean => HELP_REQUEST.test(text.trim());

/** What the Cat knows about a board nobody has sketched yet. */
export const BLANK_BOARD_BRIEF: RoomBrief = {
  id: "blank",
  allowedNatures: "all",
  hints: [
    "An empty board. Sketch some ground, and write 'ground' beside it.",
    "Give things roles: 'goal', 'lava', 'start here'. Or spirits: 'bouncy', 'ladder', 'cloud'.",
    "Then bend the world: write 'g = moon', 'no friction', 'wind blows right', 'slow motion'.",
  ],
};
