import type { RoomBrief } from "../cat/types";
import type { PlacementRejection } from "../ink/types";

export const WORDMARK = "kami";
export const TAGLINE = "draw it. name it. it wakes up.";

export const REJECTION_LINES: Readonly<Record<PlacementRejection, string>> = {
  "no-ink-zone": "That part's painted red. It won't take ink.",
  "overlaps-alice": "Not on Alice, if you please. Beside her.",
  "too-detailed": "Too much detail for one drawing. Try drawing it in smaller parts.",
  "out-of-bounds": "That is beyond the edge of this board. Draw closer to Alice.",
};

export const SHRUGS: readonly string[] = [
  "Hm. I can't make that true. Yet.",
  "Write it beside a drawing, or tell me a law of physics.",
  "Curious. But what should it do?",
];

export const LAW_OUTSIDE_MODE_LINE = "Not in this game. The page won't take that law here.";

export const KEY_TAKEN_LINE = "A key! Now, whichever door could it be for?";
export const DOOR_OPENED_LINE = "Click. After you.";
export const GROW_BLOCKED_LINE = "No room to grow in here.";
export const GOAL_LINE = "Down the rabbit hole. You drew your way here.";
export const RULE_REPEALED_LINE = "Struck from the laws of nature.";
export const STUCK_LINE = "She can't see a way on. Draw her one.";
export const PONDERING_LINE = "hmm...";
export const CANNOT_DRAW_LINE = (what: string): string =>
  `I've never seen ${what}. Draw one for me, and I'll learn its name.`;
export const OFFER_HELP_HINT = "(write 'help' anywhere)";
export const NOWHERE_LINE = (where: string): string =>
  `I don't know the way to ${where}. Tell me what it's like there and I'll make it.`;

/** The gloss under "teleport us to the moon": the place, then every law it brought. */
export const sceneGlossOf = (place: string, laws: readonly string[]): string =>
  glossOf(laws.length === 0 ? place : `${place}: ${laws.join(", ")}`);

/**
 * The Sumikui, the ink eater. Kami is the paper; ink is its lifeblood. Long ago something under the
 * page tore it, and the Sumikui broke off that older thing and came through the tear. It is of the
 * paper now, so what is written on the paper binds it.
 */
export const SUMIKUI_SUMMONED_LINES: readonly string[] = [
  "You wrote its name. The Sumikui, the ink eater, hears.",
  "Long ago something under the page tore it. This broke off of that, and came through.",
  "It is of the paper now. What is written binds it. So does what you wrote.",
];
export const SUMIKUI_WOKE_LINE = "It smells ink. Ink is my blood, and it has never had its fill.";
export const SUMIKUI_DEVOURED_LINES: readonly string[] = [
  "Gone. It drank that line to the last drop.",
  "Another one. It only takes what she leans on.",
  "It fed. It is quicker than it was.",
];
export const SUMIKUI_PAPER_BITTEN_LINES: readonly string[] = [
  "It bit the ground itself. The page is ink too, to it.",
  "A hole where she stood. Paper heals; slowly.",
  "It eats the floor out from under her now. Draw her a way across.",
];
export const SUMIKUI_ALICE_DEVOURED_LINES: readonly string[] = [
  "It had her. She is ink like the rest, and I have set her down again.",
  "Gone in one swallow. It is gorged now, and slow. Run while it is.",
  "Keep her moving. It only catches what stands still.",
];
export const ALICE_FLEES_LINES: readonly string[] = [
  "She sees it. She runs. Draw her somewhere to run to.",
  "It is on her heels. She will not stand and be eaten.",
  "Look at her go. Fear is a fine teacher.",
];
export const ALICE_CORNERED_LINE = "Nowhere left to run. Draw her a way out, quickly.";
export const WARPED_LINES: readonly string[] = [
  "In one, out the other. The paper is smaller than it looks.",
  "Through and through. She never did care for the long way round.",
  "There she goes. Here she is.",
];
export const PORTAL_LONELY_LINE = "It leads nowhere yet. Draw it a twin.";
export const SUMIKUI_SEALED_LINE = "Sealed. It waits under the page, with the one it came from.";
export const SUMIKUI_LORE_LINE_DELAY_MS = 3_200;

export const glossOf = (explanation: string): string => `kami: ${explanation}`;

/** Said aloud, he does not sign his own name — and would only wake himself if he did. */
export const aloud = (text: string): string => text.replace(/^kami:\s*/i, "");

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

/** How Kami tells the Alices apart: Alice herself, then her twins by number. */
export const aliceName = (who: number): string => (who === 0 ? "Alice" : `Alice ${who + 1}`);
export const TWIN_GOAL_LINE = (who: number): string =>
  `${aliceName(who)} found the rabbit hole. One of you was enough.`;
export const TWIN_SELECTED_LINE = (who: number): string => `${aliceName(who)}, then. Lead on.`;
/** Prefix a line about one Alice among several with her name, so the player knows who it was. */
export const aboutAlice = (who: number, line: string): string =>
  who === 0 ? line : `${aliceName(who)}: ${line}`;
