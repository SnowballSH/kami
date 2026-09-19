import { EARTH_G_MPS2 } from "../core/physics";
import type { WorldEdit, WorldFacts } from "../world/types";
import { NATURES, type Nature } from "./types";

/** One pattern of words the scripted Cat knows how to turn into world edits. */
interface Spell {
  readonly pattern: RegExp;
  readonly cast: (match: RegExpMatchArray, facts: WorldFacts) => readonly WorldEdit[];
  readonly line: string;
}

const NUMBER = String.raw`(-?\d+(?:\.\d+)?)`;
const WORLD_WORDS = String.raw`(?:world|floor|ground|everything|everywhere|page|room|all|air)`;
const ALICE_WORDS = String.raw`(?:alice|she|her)`;
const SET = String.raw`(?:\s*(?:=|:|is|to|of|at))?\s*`;

const numberOf = (match: RegExpMatchArray, group: number, fallback: number): number => {
  const raw = match[group];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const DIRECTION_ANGLES: Readonly<Record<string, number>> = {
  up: -90,
  down: 90,
  left: 180,
  right: 0,
};

const directionOf = (word: string | undefined, fallback: number): number =>
  word === undefined ? fallback : (DIRECTION_ANGLES[word] ?? fallback);

const unitVector = (angleDeg: number, magnitude: number): { x: number; y: number } => {
  const radians = (angleDeg * Math.PI) / 180;
  return { x: magnitude * Math.cos(radians), y: magnitude * Math.sin(radians) };
};

const gravityOf = (magnitudeG: number): WorldEdit => ({ op: "set_gravity", magnitudeG });

const natureIn = (word: string): Nature | null => NATURES.find((nature) => nature === word) ?? null;

const everyDrawing = (
  facts: WorldFacts,
  edit: (id: WorldFacts["drawings"][number]["id"]) => WorldEdit,
) => facts.drawings.map((drawing) => edit(drawing.id));

const MOON_G = 0.165;
const MARS_G = 0.38;
const JUPITER_G = 2.5;
const SLOW_MOTION = 0.4;
const FAST_FORWARD = 2;
const BREEZE = 0.3;
const WIND = 0.6;
const GALE = 1.4;
const RUBBER = 0.9;
const ICE_FRICTION = 0.05;
const GRIPPY_FRICTION = 3;
const SYRUP_DRAG = 8;
const HURRY = 2;
const DAWDLE = 0.5;
const INFINITE_INK = 1_000_000;

export const SPELLBOOK: readonly Spell[] = [
  {
    pattern:
      /\b(?:no|zero|without|off|kill)\s*(?:the\s+)?g(?:ravity)?\b|\bg(?:ravity)?\s+(?:off|gone|away)\b|\bweightless(?:ness)?\b/,
    cast: () => [gravityOf(0)],
    line: "There. Nothing holds anything down. I've always lived like this.",
  },
  {
    pattern: /\bmoon\b.*\bg(?:ravity)?\b|\bg(?:ravity)?\b.*\bmoon\b|\bon the moon\b/,
    cast: () => [gravityOf(MOON_G)],
    line: "Moon rules. Everything takes its time coming down.",
  },
  {
    pattern: /\bmars\b/,
    cast: () => [gravityOf(MARS_G)],
    line: "Mars. Redder in my imagination, but the falling is right.",
  },
  {
    pattern: /\bjupiter\b/,
    cast: () => [gravityOf(JUPITER_G)],
    line: "Jupiter. Mind your knees.",
  },
  {
    pattern:
      /\b(?:flip|reverse|invert|upside[- ]down)\b.*\bg(?:ravity)?\b|\bg(?:ravity)?\b.*\b(?:flip(?:ped)?|revers(?:e|ed)|invert(?:ed)?|upside[- ]down)\b|\bupside[- ]down\b/,
    cast: () => [{ op: "set_gravity", angleDeg: -90 }],
    line: "Up is down. Down is a rumour.",
  },
  {
    pattern: /\bg(?:ravity)?\b.*\b(up|down|left|right)(?:wards?)?\b/,
    cast: (match) => [{ op: "set_gravity", angleDeg: directionOf(match[1], 90) }],
    line: "Down has moved. Do keep up.",
  },
  {
    pattern: new RegExp(
      String.raw`\bg(?:ravity)?${SET}${NUMBER}\s*(m\s*/\s*s\s*\^?\s*2|m/s/s|ms-2|g|x|times)?`,
    ),
    cast: (match) => {
      const value = numberOf(match, 1, 1);
      const unit = match[2]?.replace(/\s/g, "");
      const metric =
        unit !== undefined
          ? unit.startsWith("m")
          : match[0].startsWith("g ") || match[0].startsWith("g=");
      return [gravityOf(metric ? value / EARTH_G_MPS2 : value)];
    },
    line: "As you say. Falling is a matter of opinion now.",
  },
  {
    pattern: new RegExp(
      String.raw`\b${ALICE_WORDS}\b.*\b(?:run|runs|fast(?:er)?|quick(?:er|ly)?|hurry|hurries|speedy|sprint)\b|\b(?:run|hurry)\b.*\b${ALICE_WORDS}\b`,
    ),
    cast: () => [{ op: "set_walk_speed", factor: HURRY }],
    line: "Off she goes. Try to keep up with the drawing.",
  },
  {
    pattern: new RegExp(
      String.raw`\b${ALICE_WORDS}\b.*\b(?:slow(?:er|ly)?|dawdle|tired|sleepy|crawl)\b|\b(?:slow)\b.*\b${ALICE_WORDS}\b`,
    ),
    cast: () => [{ op: "set_walk_speed", factor: DAWDLE }],
    line: "She'll take her time. So do I.",
  },
  {
    pattern: /\b(?:freeze|stop|pause|halt)\s+(?:the\s+)?(?:time|world|everything)\b/,
    cast: () => [{ op: "set_time_scale", factor: 0 }],
    line: "Stopped. Tea will keep.",
  },
  {
    pattern: new RegExp(
      String.raw`\btime(?:\s*scale)?${SET}${NUMBER}\s*x?\b|\b${NUMBER}\s*x\s*(?:speed|time)\b`,
    ),
    cast: (match) => [{ op: "set_time_scale", factor: numberOf(match, 1, numberOf(match, 2, 1)) }],
    line: "Time bends. It always did, for me.",
  },
  {
    pattern: /\bslow[- ]?(?:motion|mo|time)\b|\bslow(?:er|\s+down)?\b(?!.*\b(?:alice|she|her)\b)/,
    cast: () => [{ op: "set_time_scale", factor: SLOW_MOTION }],
    line: "Slowly, then. Like treacle.",
  },
  {
    pattern:
      /\bfast[- ]?forward\b|\b(?:speed up|faster|hurry up|quick(?:er|ly)?)\b(?!.*\b(?:alice|she|her)\b)/,
    cast: () => [{ op: "set_time_scale", factor: FAST_FORWARD }],
    line: "Quickly, quickly. No time to say hello, goodbye.",
  },
  {
    pattern:
      /\b(?:no|zero|stop(?:\s+the)?|calm|still)\s+(?:wind|air|breeze)\b|\bwind\s+(?:off|gone|down)\b/,
    cast: () => [{ op: "set_wind", x: 0, y: 0 }],
    line: "Calm again. My whiskers thank you.",
  },
  {
    pattern: new RegExp(
      String.raw`\b(breeze|wind(?:y)?|gale|storm|hurricane|gust)\b(?:.*?\b(up|down|left|right)(?:wards?)?\b)?(?:.*?${NUMBER})?`,
    ),
    cast: (match) => {
      const word = match[1] ?? "wind";
      const magnitude = numberOf(
        match,
        3,
        word === "breeze" ? BREEZE : word === "wind" || word === "windy" ? WIND : GALE,
      );
      const { x, y } = unitVector(directionOf(match[2], 0), magnitude);
      return [{ op: "set_wind", x, y }];
    },
    line: "Hold on to your hat. Or draw one.",
  },
  {
    pattern: new RegExp(
      String.raw`\b(?:bounc(?:e|y|iness)|restitution|rubber|trampoline)\b(?:.*?${NUMBER})?`,
    ),
    cast: (match) => [{ op: "set_bounciness", restitution: numberOf(match, 1, RUBBER) }],
    line: "Everything's rubber. Even the mistakes bounce back.",
  },
  {
    pattern: /\b(?:no|zero|without)\s+friction\b|\bfrictionless\b/,
    cast: () => [{ op: "set_friction", factor: 0 }],
    line: "Nothing grips anything. Rather like conversation with the Hatter.",
  },
  {
    pattern: new RegExp(
      String.raw`\b(?:ice|icy|slippery|slippy|soap(?:y)?|oil(?:y)?)\b.*\b${WORLD_WORDS}\b|\b${WORLD_WORDS}\b.*\b(?:ice|icy|slippery|slippy|soap(?:y)?|oil(?:y)?)\b`,
    ),
    cast: () => [{ op: "set_friction", factor: ICE_FRICTION }],
    line: "Careful. The whole page has gone to ice.",
  },
  {
    pattern: new RegExp(
      String.raw`\b(?:sticky|grippy|velcro|sandpaper|tacky)\b.*\b${WORLD_WORDS}\b|\b${WORLD_WORDS}\b.*\b(?:sticky|grippy|velcro|sandpaper|tacky)\b`,
    ),
    cast: () => [{ op: "set_friction", factor: GRIPPY_FRICTION }],
    line: "Everything clings now. Mind where she steps.",
  },
  {
    pattern: new RegExp(String.raw`\bfriction${SET}${NUMBER}`),
    cast: (match) => [{ op: "set_friction", factor: numberOf(match, 1, 1) }],
    line: "Grip adjusted. As you like it.",
  },
  {
    pattern: /\bvacuum\b|\bno\s+air\b|\bairless\b/,
    cast: () => [{ op: "set_air_drag", factor: 0 }],
    line: "No air. Nothing to slow anything, or to say it in.",
  },
  {
    pattern: /\b(?:under\s?water|water|syrup|treacle|honey|soup|thick\s+air|molasses)\b/,
    cast: () => [{ op: "set_air_drag", factor: SYRUP_DRAG }],
    line: "Everything wades now. Slow and sticky.",
  },
  {
    pattern: new RegExp(String.raw`\b(?:air\s*(?:drag|resistance|friction)|drag)${SET}${NUMBER}`),
    cast: (match) => [{ op: "set_air_drag", factor: numberOf(match, 1, 1) }],
    line: "The air has changed its mind about you.",
  },
  {
    pattern: new RegExp(String.raw`\b(?:walk(?:ing)?\s*)?speed${SET}${NUMBER}`),
    cast: (match) => [{ op: "set_walk_speed", factor: numberOf(match, 1, 1) }],
    line: "New pace. Feet, take note.",
  },
  {
    pattern: new RegExp(
      String.raw`\b${ALICE_WORDS}\b.*\b(big|bigger|giant|huge|tall|grow|grows|large|small|smaller|tiny|little|shrink|shrinks|normal|usual)\b|\b(grow|shrink)\b\s+${ALICE_WORDS}\b`,
    ),
    cast: (match) => {
      const word = match[1] ?? match[2] ?? "normal";
      const size = /^(?:small|smaller|tiny|little|shrink|shrinks)$/.test(word)
        ? "small"
        : /^(?:normal|usual)$/.test(word)
          ? "normal"
          : "big";
      return [{ op: "resize_alice", size }];
    },
    line: "Curiouser and curiouser. She's changed size again.",
  },
  {
    pattern: /\b(?:infinite|unlimited|endless|bottomless)\s+ink\b|\bink\s+(?:forever|unlimited)\b/,
    cast: () => [{ op: "set_ink", total: INFINITE_INK, remaining: INFINITE_INK }],
    line: "A bottomless inkwell. Try not to drown in it.",
  },
  {
    pattern: /\bmore\s+ink\b|\brefill\b|\bfull\s+ink\b/,
    cast: (_, facts) => [{ op: "set_ink", remaining: facts.room.ink.total }],
    line: "Topped up. Spend it wisely, or don't.",
  },
  {
    pattern: new RegExp(String.raw`\bink${SET}${NUMBER}`),
    cast: (match) => [{ op: "set_ink", remaining: numberOf(match, 1, 0) }],
    line: "That much ink and not a drop more.",
  },
  {
    pattern:
      /\b(?:erase|delete|remove|clear|wipe)\s+(?:all|everything|the\s+ink|every\s+drawing|the\s+drawings|the\s+page)\b|\bclean\s+(?:slate|page)\b/,
    cast: (_, facts) => everyDrawing(facts, (drawingId) => ({ op: "remove_drawing", drawingId })),
    line: "Gone, every scribble. What a clean page. How dull.",
  },
  {
    pattern: new RegExp(
      String.raw`\b(?:all|everything|every\s+drawing|all\s+(?:the\s+)?drawings)\b.*\b(${NATURES.join("|")})\b`,
    ),
    cast: (match, facts) => {
      const nature = natureIn(match[1] ?? "");
      return nature === null
        ? []
        : everyDrawing(facts, (drawingId) => ({ op: "set_nature", drawingId, nature }));
    },
    line: "All of it, at once. Ink does love a fashion.",
  },
  {
    pattern: /\b(?:reset|normal|undo|earth|ordinary|default)\b(?!.*\b(?:alice|she|her)\b)/,
    cast: () => [{ op: "reset_physics" }],
    line: "Back to the boring rules. For now.",
  },
];

export const NO_SPELL_LINE = "Words, words. None of them mine to grant.";
