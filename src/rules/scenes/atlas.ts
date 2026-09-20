import type { Vec } from "../../core/geometry";
import { earthRule, gravityRule, scalarRule, windRule } from "../effects";
import type { CompiledRule, Prop, Scene, WorldGoverns } from "../types";

const HIGH_LEFT: Vec = { x: -300, y: -280 };
const HIGH: Vec = { x: -60, y: -330 };
const HIGH_RIGHT: Vec = { x: 240, y: -300 };
const MID_LEFT: Vec = { x: -340, y: -140 };
const MID_RIGHT: Vec = { x: 300, y: -150 };
const LOW_LEFT: Vec = { x: -250, y: -40 };
const LOW_RIGHT: Vec = { x: 230, y: -50 };
const FAR_LEFT: Vec = { x: -430, y: -90 };
const FAR_RIGHT: Vec = { x: 410, y: -100 };

const prop = (word: string, at: Vec, size = 1): Prop => ({ word, at, size });

const stars = (...at: readonly Vec[]): readonly Prop[] => at.map((spot) => prop("star", spot, 0.3));

interface Place {
  readonly aliases: readonly string[];
  readonly scene: Scene;
}

const place = (
  aliases: readonly string[],
  scene: Omit<Scene, "props"> & { readonly props?: readonly Prop[] },
): Place => ({ aliases, scene: { props: [], ...scene } });

const EARTH_DIALS: readonly WorldGoverns[] = [
  "gravity",
  "wind",
  "timeScale",
  "airDrag",
  "friction",
  "bounciness",
  "temperature",
  "daylight",
];

const homeLaws = (): readonly CompiledRule[] => EARTH_DIALS.map(earthRule);

/** The places Kami knows how to make without asking anyone, and how each is asked for. */
export const ATLAS: readonly Place[] = [
  place(["home", "earth", "back home", "normal", "wonderland"], {
    place: "home",
    laws: homeLaws(),
    line: "Home. Same old gravity.",
  }),
  place(["moon", "lunar surface", "luna"], {
    place: "the Moon",
    laws: [
      gravityRule({ x: 0, y: 0.165 }, "the Moon"),
      scalarRule("airDrag", 0),
      scalarRule("daylight", 0.3),
    ],
    props: [prop("moon", HIGH_RIGHT, 0.8), ...stars(HIGH_LEFT, MID_LEFT, HIGH)],
    line: "One small step. Mind the dust.",
  }),
  place(["mars", "red planet"], {
    place: "Mars",
    laws: [
      gravityRule({ x: 0, y: 0.38 }, "Mars"),
      scalarRule("temperature", -60),
      scalarRule("daylight", 0.7),
    ],
    props: [prop("moon", HIGH_LEFT, 0.6), prop("flying saucer", HIGH_RIGHT, 0.9)],
    line: "Red dust to the horizon. Nobody home.",
  }),
  place(["jupiter"], {
    place: "Jupiter",
    laws: [gravityRule({ x: 0, y: 2.53 }, "Jupiter"), windRule({ x: 0.4, y: 0 })],
    props: [prop("hurricane", HIGH_RIGHT, 1.2), prop("lightning", HIGH_LEFT, 0.6)],
    line: "Heavy. Very heavy. And the wind never stops.",
  }),
  place(["space", "outer space", "orbit", "stars", "zero gravity", "zero g", "cosmos"], {
    place: "space",
    laws: [gravityRule({ x: 0, y: 0 }), scalarRule("airDrag", 0), scalarRule("daylight", 0.15)],
    props: [
      prop("moon", HIGH_RIGHT, 1.1),
      prop("flying saucer", MID_LEFT, 0.8),
      ...stars(HIGH_LEFT, HIGH, FAR_RIGHT, LOW_LEFT),
    ],
    line: "No up. No down. Nothing to stand on but what you draw.",
  }),
  place(["sun"], {
    place: "the Sun",
    laws: [scalarRule("temperature", 1000), scalarRule("daylight", 1)],
    props: [prop("sun", HIGH, 1.6)],
    line: "Everything melts here. Even good ideas.",
  }),
  place(
    [
      "ocean",
      "sea",
      "underwater",
      "under the sea",
      "deep",
      "atlantis",
      "seabed",
      "bottom of the sea",
    ],
    {
      place: "the ocean",
      laws: [
        gravityRule({ x: 0, y: 0.3 }),
        scalarRule("airDrag", 8),
        scalarRule("walkSpeed", 0.6),
        scalarRule("daylight", 0.6),
      ],
      props: [
        prop("fish", MID_LEFT, 0.6),
        prop("fish", LOW_RIGHT, 0.5),
        prop("octopus", HIGH_RIGHT, 0.9),
        prop("whale", HIGH_LEFT, 1.4),
        prop("sea turtle", FAR_RIGHT, 0.7),
      ],
      line: "Hold your breath. Everything is slow down here.",
    },
  ),
  place(["arctic", "north pole", "south pole", "antarctica", "ice", "greenland", "tundra"], {
    place: "the Arctic",
    laws: [
      scalarRule("temperature", -40),
      scalarRule("friction", 0.1),
      scalarRule("daylight", 0.8),
    ],
    props: [
      prop("penguin", LOW_LEFT, 0.7),
      prop("snowman", LOW_RIGHT, 0.9),
      prop("snowflake", HIGH_LEFT, 0.4),
      prop("snowflake", HIGH, 0.35),
      prop("snowflake", HIGH_RIGHT, 0.45),
    ],
    line: "Cold. Slippery. Penguins.",
  }),
  place(["desert", "sahara", "dunes", "sand"], {
    place: "the desert",
    laws: [scalarRule("temperature", 45), windRule({ x: 0.15, y: 0 }), scalarRule("daylight", 1)],
    props: [
      prop("sun", HIGH_RIGHT, 1.1),
      prop("cactus", LOW_LEFT, 0.9),
      prop("cactus", FAR_RIGHT, 0.7),
      prop("camel", MID_LEFT, 1),
    ],
    line: "Hot sand. Keep to the shade you draw.",
  }),
  place(["jungle", "rainforest", "amazon"], {
    place: "the jungle",
    laws: [scalarRule("temperature", 32), scalarRule("friction", 1.5), scalarRule("daylight", 0.7)],
    props: [
      prop("tree", FAR_LEFT, 1.5),
      prop("tree", FAR_RIGHT, 1.3),
      prop("monkey", HIGH_LEFT, 0.7),
      prop("parrot", HIGH_RIGHT, 0.6),
      prop("snake", LOW_RIGHT, 0.7),
    ],
    line: "Everything here is alive. Some of it hungry.",
  }),
  place(["volcano", "lava", "underworld", "inferno", "hell"], {
    place: "the volcano",
    laws: [
      scalarRule("temperature", 500),
      scalarRule("daylight", 0.5),
      windRule({ x: 0, y: -0.2 }),
    ],
    props: [prop("mountain", HIGH_RIGHT, 1.6), prop("campfire", LOW_LEFT, 0.8)],
    line: "Don't touch the floor.",
  }),
  place(["sky", "clouds", "heaven", "heavens", "cloud kingdom", "above the clouds"], {
    place: "the sky",
    laws: [
      gravityRule({ x: 0, y: 0.5 }),
      windRule({ x: 0.2, y: 0 }),
      scalarRule("flight", 1),
      scalarRule("daylight", 1),
    ],
    props: [
      prop("cloud", HIGH_LEFT, 1),
      prop("cloud", HIGH_RIGHT, 1.2),
      prop("cloud", FAR_LEFT, 0.8),
      prop("sun", HIGH, 0.9),
      prop("hot air balloon", MID_RIGHT, 1),
      prop("bird", LOW_LEFT, 0.4),
    ],
    line: "Nothing but clouds. Try not to look down.",
  }),
  place(["candy land", "candyland", "sugar land", "dessert land", "bakery", "sweet shop"], {
    place: "Candy Land",
    laws: [scalarRule("bounciness", 0.9), scalarRule("friction", 0.6)],
    props: [
      prop("lollipop", HIGH_LEFT, 0.9),
      prop("lollipop", FAR_RIGHT, 0.7),
      prop("ice cream", HIGH_RIGHT, 0.9),
      prop("birthday cake", LOW_LEFT, 1),
      prop("donut", MID_RIGHT, 0.7),
    ],
    line: "Everything bounces. Everything is dessert.",
  }),
  place(["night", "midnight", "dark", "night time", "nighttime"], {
    place: "the night",
    laws: [scalarRule("daylight", 0.1)],
    props: [
      prop("moon", HIGH_RIGHT, 0.9),
      prop("owl", MID_LEFT, 0.6),
      ...stars(HIGH_LEFT, HIGH, FAR_RIGHT),
    ],
    line: "Lights out. Draw a lantern.",
  }),
  place(["farm", "countryside", "country", "village"], {
    place: "the farm",
    laws: [scalarRule("temperature", 22), windRule({ x: 0.05, y: 0 })],
    props: [
      prop("barn", FAR_RIGHT, 1.4),
      prop("cow", LOW_LEFT, 0.9),
      prop("pig", LOW_RIGHT, 0.6),
      prop("tractor", MID_LEFT, 1),
      prop("sheep", FAR_LEFT, 0.6),
      prop("sun", HIGH, 0.8),
    ],
    line: "Mind the cows.",
  }),
  place(["city", "town", "new york", "tokyo", "london", "paris", "metropolis", "downtown"], {
    place: "the city",
    laws: [scalarRule("daylight", 0.9)],
    props: [
      prop("skyscraper", FAR_LEFT, 1.8),
      prop("skyscraper", HIGH_RIGHT, 1.6),
      prop("skyscraper", MID_LEFT, 1.2),
      prop("car", LOW_RIGHT, 0.8),
      prop("traffic light", LOW_LEFT, 0.6),
    ],
    line: "Loud. Tall. Nobody looks up.",
  }),
  place(["beach", "seaside", "hawaii", "island", "tropics", "coast"], {
    place: "the beach",
    laws: [scalarRule("temperature", 30), windRule({ x: 0.1, y: 0 }), scalarRule("daylight", 1)],
    props: [
      prop("palm tree", FAR_LEFT, 1.4),
      prop("palm tree", FAR_RIGHT, 1.2),
      prop("sun", HIGH, 1),
      prop("sailboat", HIGH_RIGHT, 0.9),
      prop("crab", LOW_LEFT, 0.5),
    ],
    line: "Sand in everything.",
  }),
  place(["forest", "woods", "enchanted forest"], {
    place: "the forest",
    laws: [scalarRule("temperature", 15), scalarRule("daylight", 0.6)],
    props: [
      prop("tree", FAR_LEFT, 1.5),
      prop("tree", HIGH_RIGHT, 1.4),
      prop("tree", MID_LEFT, 1.1),
      prop("mushroom", LOW_LEFT, 0.5),
      prop("owl", HIGH_LEFT, 0.5),
      prop("squirrel", LOW_RIGHT, 0.5),
    ],
    line: "Quiet. Watch the roots.",
  }),
  place(["mountain", "mountains", "everest", "alps", "summit", "peak", "himalayas"], {
    place: "the mountains",
    laws: [scalarRule("temperature", -10), windRule({ x: 0.3, y: 0 }), scalarRule("airDrag", 0.5)],
    props: [
      prop("mountain", FAR_LEFT, 1.8),
      prop("mountain", HIGH_RIGHT, 1.6),
      prop("snowflake", HIGH, 0.4),
      prop("bird", HIGH_LEFT, 0.4),
    ],
    line: "Thin air. Long way down.",
  }),
  place(["dream", "dreamland", "dreams", "sleep", "la la land"], {
    place: "a dream",
    laws: [
      scalarRule("timeScale", 0.5),
      gravityRule({ x: 0, y: 0.4 }),
      scalarRule("daylight", 0.5),
      scalarRule("bounciness", 0.5),
    ],
    props: [
      prop("cloud", HIGH_LEFT, 1),
      prop("moon", HIGH_RIGHT, 0.8),
      prop("bed", LOW_RIGHT, 1),
      ...stars(HIGH, MID_LEFT),
    ],
    line: "Don't wake up.",
  }),
  place(["haunted house", "graveyard", "halloween", "haunted mansion", "spooky place", "crypt"], {
    place: "the haunted house",
    laws: [scalarRule("daylight", 0.1), windRule({ x: 0.1, y: 0 })],
    props: [
      prop("castle", HIGH_RIGHT, 1.6),
      prop("skull", LOW_LEFT, 0.5),
      prop("spider", HIGH_LEFT, 0.5),
      prop("bat", HIGH, 0.5),
      prop("moon", FAR_LEFT, 0.7),
    ],
    line: "Something's watching.",
  }),
  place(["storm", "thunderstorm", "tempest", "hurricane", "monsoon"], {
    place: "the storm",
    laws: [windRule({ x: 0.6, y: 0 }), scalarRule("airDrag", 1.5), scalarRule("daylight", 0.4)],
    props: [
      prop("cloud", HIGH_LEFT, 1.2),
      prop("cloud", HIGH_RIGHT, 1.1),
      prop("lightning", HIGH, 0.7),
      prop("rain", MID_LEFT, 0.6),
      prop("umbrella", LOW_RIGHT, 0.6),
    ],
    line: "Hold on to something.",
  }),
  place(["tornado alley", "tornado", "twister"], {
    place: "tornado alley",
    laws: [windRule({ x: 1.5, y: 0 }), scalarRule("daylight", 0.5)],
    props: [prop("tornado", HIGH_RIGHT, 1.8), prop("cow", HIGH_LEFT, 0.6)],
    line: "That cow was on the ground a moment ago.",
  }),
  place(["castle", "kingdom", "fairyland", "fairy tale", "camelot", "medieval times"], {
    place: "the kingdom",
    laws: [scalarRule("daylight", 0.9)],
    props: [
      prop("castle", FAR_RIGHT, 1.8),
      prop("dragon", HIGH_LEFT, 1.2),
      prop("crown", LOW_LEFT, 0.4),
      prop("sword", LOW_RIGHT, 0.5),
      prop("horse", MID_LEFT, 0.8),
    ],
    line: "Mind the dragon. It has not had lunch.",
  }),
  place(["pond", "swamp", "marsh", "lake"], {
    place: "the pond",
    laws: [scalarRule("airDrag", 3), scalarRule("friction", 0.5), scalarRule("temperature", 18)],
    props: [
      prop("frog", LOW_LEFT, 0.5),
      prop("duck", LOW_RIGHT, 0.6),
      prop("swan", MID_RIGHT, 0.8),
      prop("mosquito", HIGH_LEFT, 0.3),
    ],
    line: "Squelch.",
  }),
];

const endsWithWord = (where: string, alias: string): boolean =>
  where === alias || where.endsWith(` ${alias}`);

/** The place a destination names, taking "the big blue ocean" for the ocean; null when unknown. */
export const placeCalled = (where: string): Scene | null => {
  const exact = ATLAS.find(({ aliases }) => aliases.includes(where));
  if (exact !== undefined) return exact.scene;
  const near = ATLAS.find(({ aliases }) => aliases.some((alias) => endsWithWord(where, alias)));
  return near?.scene ?? null;
};
