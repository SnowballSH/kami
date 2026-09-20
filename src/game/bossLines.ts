import type { BodyPartKind } from "../sim/body/types";
import type { SnipperRank } from "../sim/boss/tuning";

export const SOUL_WAITS_LINE = "Only a heart, so far. Draw it a body, and write who it is.";
export const INCARNATED_LINE = (name: string): string =>
  `There. The ink is ${name} now — walk it, and keep it whole.`;
export const UNMADE_LINE = "Gone back into the pen. Draw her again.";

export const TEAR_OPENS_LINES: readonly string[] = [
  "Something is cutting through from under the page. Not the Sumikui. Another of its kind.",
  "It comes to snip. Watch its arms draw back — that is your moment to move.",
];
export const SERVANT_CAME_LINE =
  "It is through. Keep her out from under it; draw her what it takes.";
export const SERVANTS_CAME_LINE = (lessers: number): string =>
  lessers === 1
    ? "It calls for help. A smaller one, quicker. Do not let it split you up."
    : `It calls for help. ${lessers} smaller ones, quicker. Keep drawing.`;

const PART_NAMES: Record<BodyPartKind, string> = {
  head: "head",
  torso: "middle",
  arms: "arms",
  legs: "legs",
  wings: "wings",
};

export const SNIPPED_LINE = (part: BodyPartKind, lost: readonly BodyPartKind[]): string => {
  const [gone] = lost;
  if (gone === undefined) return `A snip across her ${PART_NAMES[part]}. She is still whole. Move.`;
  switch (gone) {
    case "legs":
      return "It took her legs. She cannot walk — draw them back, quickly.";
    case "arms":
      return "It took her arms. No climbing now. Draw them back.";
    case "wings":
      return "Her wings, gone. She is earthbound until you draw them again.";
    case "head":
      return "Her head. The page is dimming for her — draw it back.";
    case "torso":
      return "It cut her middle. The heart is bare. Draw around it.";
  }
};
export const SNIP_MISSED_LINE = "Missed. It cut only paper. Well dodged.";
export const SHIELDED_LINE = "It cut your drawing instead of her. Good — draw more of those.";
export const SERVANT_STRUCK_LINE = (rank: SnipperRank): string =>
  rank === "servant" ? "You hurt it. It can be hurt. Again." : "The small one felt that.";
export const SERVANT_PERISHED_LINE = (rank: SnipperRank): string =>
  rank === "servant"
    ? "It is coming apart. The tear is closing behind it."
    : "One fewer of the small ones.";
export const TEAR_CLOSED_LINE =
  "Closed. The page is whole, and so are you two. I was afraid — I am not now.";
export const HEART_SWALLOWED_LINE = "It took the heart. Unmade. I will open the room again.";
export const PART_RESTORED_LINE = (parts: readonly BodyPartKind[]): string => {
  const [part] = parts;
  return part === undefined ? "She is mended." : `Her ${PART_NAMES[part]}, back. Feel that? Go.`;
};
