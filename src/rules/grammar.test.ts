import { describe, expect, it } from "vitest";
import { createRuleCompiler } from "./index";
import type { RuleEffect, Target } from "./types";

type Understood = readonly [says: string, effect: RuleEffect, gloss: string];

const gravity = (x: number, y: number): RuleEffect => ({ governs: "gravity", x, y });
const wind = (x: number, y: number): RuleEffect => ({ governs: "wind", x, y });
const time = (value: number): RuleEffect => ({ governs: "timeScale", value });
const friction = (value: number): RuleEffect => ({ governs: "friction", value });
const bounciness = (value: number): RuleEffect => ({ governs: "bounciness", value });
const airDrag = (value: number): RuleEffect => ({ governs: "airDrag", value });
const dial =
  (
    governs:
      | "temperature"
      | "daylight"
      | "flight"
      | "walkSpeed"
      | "aliceSize"
      | "attraction"
      | "clones"
      | "inkEater",
  ) =>
  (value: number): RuleEffect => ({ governs, value });
const temperature = dial("temperature");
const daylight = dial("daylight");
const flight = dial("flight");
const walkSpeed = dial("walkSpeed");
const aliceSize = dial("aliceSize");
const attraction = dial("attraction");
const clones = dial("clones");
const inkEater = dial("inkEater");
const named = (name: string): Target => ({ kind: "named", name });
const ALL: Target = { kind: "all" };
const spin = (of: Target, value: number): RuleEffect => ({ governs: "spin", of, value });
const thrust = (of: Target, x: number, y: number): RuleEffect => ({ governs: "thrust", of, x, y });
const mass = (of: Target, value: number): RuleEffect => ({ governs: "mass", of, value });
const bounce = (of: Target, value: number): RuleEffect => ({ governs: "bounce", of, value });
const grip = (of: Target, value: number): RuleEffect => ({ governs: "grip", of, value });

const UNDERSTOOD: readonly Understood[] = [
  ["g = moon", gravity(0, 0.165), "gravity = 0.17 g (the Moon)"],
  ["set g equal to the moon's gravity", gravity(0, 0.165), "gravity = 0.17 g (the Moon)"],
  ["Set G equal to the Moon’s gravity.", gravity(0, 0.165), "gravity = 0.17 g (the Moon)"],
  ["gravity like mars", gravity(0, 0.38), "gravity = 0.38 g (Mars)"],
  ["jupiter gravity", gravity(0, 2.53), "gravity = 2.53 g (Jupiter)"],
  ["please make the gravity equal to pluto", gravity(0, 0.063), "gravity = 0.06 g (Pluto)"],
  ["we are on the moon", gravity(0, 0.165), "gravity = 0.17 g (the Moon)"],
  ["twice earth gravity", gravity(0, 2), "gravity = 2 g (2x Earth)"],
  ["sun gravity", gravity(0, 5), "gravity = 5 g (the Sun, capped)"],
  ["g = 3.7", gravity(0, 0.377), "gravity = 0.38 g"],
  ["g = 3.7 m/s^2", gravity(0, 0.377), "gravity = 0.38 g"],
  ["g=9.81m/s²", gravity(0, 1), "gravity = 1 g"],
  ["gravity is 1.62 meters per second squared", gravity(0, 0.165), "gravity = 0.17 g"],
  ["gravity = 0.5g", gravity(0, 0.5), "gravity = 0.5 g"],
  ["half gravity", gravity(0, 0.5), "gravity = 0.5 g"],
  ["double gravity", gravity(0, 2), "gravity = 2 g"],
  ["gravity = 40 g", gravity(0, 5), "gravity = 5 g (capped)"],
  ["low gravity", gravity(0, 0.4), "gravity = 0.4 g"],
  ["no gravity", gravity(0, 0), "gravity off"],
  ["zero g", gravity(0, 0), "gravity off"],
  ["g = 0", gravity(0, 0), "gravity off"],
  ["turn off gravity", gravity(0, 0), "gravity off"],
  ["everything floats", gravity(0, 0), "gravity off"],
  ["gravity up", gravity(0, -1), "gravity = 1 g, upward"],
  ["gravity sideways", gravity(1, 0), "gravity = 1 g, to the right"],
  ["gravity points left", gravity(-1, 0), "gravity = 1 g, to the left"],
  ["flip gravity", gravity(0, -1), "gravity = 1 g, upward"],
  ["anti-gravity", gravity(0, -1), "gravity = 1 g, upward"],
  ["gravity = -1 g", gravity(0, -1), "gravity = 1 g, upward"],
  ["moon gravity to the left", gravity(-0.165, 0), "gravity = 0.17 g, to the left (the Moon)"],
  ["gravity = 1 g, upward", gravity(0, -1), "gravity = 1 g, upward"],
  ["slow motion", time(0.5), "time runs at 0.5x"],
  ["slow-mo", time(0.5), "time runs at 0.5x"],
  ["time = 0.5", time(0.5), "time runs at 0.5x"],
  ["half speed", time(0.5), "time runs at 0.5x"],
  ["time x2", time(2), "time runs at 2x"],
  ["2x speed", time(2), "time runs at 2x"],
  ["time 50%", time(0.5), "time runs at 0.5x"],
  ["freeze time", time(0.1), "time runs at 0.1x"],
  ["time = 10", time(3), "time runs at 3x (capped)"],
  ["turn off slow motion", time(1), "time runs at 1x"],
  ["no friction", friction(0), "friction off"],
  ["everything is ice", friction(0), "friction off"],
  ["friction = 2", friction(2), "friction = 2"],
  ["friction = 99", friction(5), "friction = 5 (capped)"],
  ["everything is bouncy", bounciness(0.8), "bounciness = 0.8"],
  ["bounciness = 0.8", bounciness(0.8), "bounciness = 0.8"],
  ["bounce = 3", bounciness(1), "bounciness = 1 (capped)"],
  ["no bounce", bounciness(0), "bounciness off"],
  ["no air", airDrag(0), "air drag off"],
  ["thick air", airDrag(4), "air drag = 4"],
  ["air resistance = 3", airDrag(3), "air drag = 3"],
  ["air = 50", airDrag(10), "air drag = 10 (capped)"],
  ["wind blows right", wind(0.3, 0), "wind = 0.3 g, to the right"],
  ["strong wind left", wind(-0.8, 0), "wind = 0.8 g, to the left"],
  ["wind = 0.3", wind(0.3, 0), "wind = 0.3 g, to the right"],
  ["wind from the left", wind(0.3, 0), "wind = 0.3 g, to the right"],
  ["wind = 9 g upward", wind(0, -2), "wind = 2 g, upward (capped)"],
  ["no wind", wind(0, 0), "wind off"],
  ["normal gravity", gravity(0, 1), "gravity = 1 g (Earth)"],
  ["back to earth", gravity(0, 1), "gravity = 1 g (Earth)"],
  ["gravity on", gravity(0, 1), "gravity = 1 g (Earth)"],
  ["reset time", time(1), "time runs at 1x"],
  ["normal speed", time(1), "time runs at 1x"],
  ["reset friction", friction(1), "friction = 1"],
  ["reset wind", wind(0, 0), "wind off"],
  ["make alice fly", flight(1), "Alice can fly"],
  ["Alice can fly", flight(1), "Alice can fly"],
  ["alice cannot fly", flight(0), "Alice walks"],
  ["alice walks twice as fast", walkSpeed(2), "Alice walks at 2x"],
  ["alice is slow", walkSpeed(0.5), "Alice walks at 0.5x"],
  ["alice is huge", aliceSize(2), "Alice is 2x her size"],
  ["alice is tiny", aliceSize(0.5), "Alice is 0.5x her size"],
  ["the girl can fly", flight(1), "Alice can fly"],
  ["make the hero huge", aliceSize(2), "Alice is 2x her size"],
  ["the player walks twice as fast", walkSpeed(2), "Alice walks at 2x"],
  ["give alice gravitational attraction", attraction(1), "Alice pulls at 1 g"],
  ["alice repels everything", attraction(-1), "Alice pulls at -1 g"],
  ["clone alice", clones(1), "1 more of Alice"],
  ["three alices", clones(2), "2 more of Alice"],
  ["it's hot", temperature(60), "temperature = 60 °C"],
  ["temperature = 100", temperature(100), "temperature = 100 °C"],
  ["freezing cold", temperature(-10), "temperature = -10 °C"],
  ["it's night", daylight(0.1), "daylight = 0.1"],
  ["morning", daylight(1), "daylight = 1"],
  ["the wheel spins", spin(named("wheel"), 1), "the wheel: spin = 1 turns/s"],
  ["make the wheel spin faster", spin(named("wheel"), 2), "the wheel: spin = 2 turns/s"],
  ["the wheel spins backwards", spin(named("wheel"), -1), "the wheel: spin = -1 turns/s"],
  ["the wheel spins at 3 turns per second", spin(named("wheel"), 3), "the wheel: spin = 3 turns/s"],
  ["the wheel stops spinning", spin(named("wheel"), 0), "the wheel: spin off"],
  ["everything spins", spin(ALL, 1), "everything: spin = 1 turns/s"],
  ["the cart accelerates", thrust(named("cart"), 0.5, 0), "the cart: thrust = 0.5 g, to the right"],
  [
    "the rocket accelerates upward",
    thrust(named("rocket"), 0, -0.5),
    "the rocket: thrust = 0.5 g, upward",
  ],
  [
    "the cart accelerates to the left at 2g",
    thrust(named("cart"), -2, 0),
    "the cart: thrust = 2 g, to the left",
  ],
  ["the rock is heavier", mass(named("rock"), 2), "the rock: weight = 2x"],
  ["the rock is twice as heavy", mass(named("rock"), 2), "the rock: weight = 2x"],
  ["every rock weighs 3 times more", mass(named("rock"), 3), "the rock: weight = 3x"],
  ["the rock is weightless", mass(named("rock"), 0.1), "the rock: weight = 0.1x"],
  ["everything is heavier", mass(ALL, 2), "everything: weight = 2x"],
  ["the ball is bouncy", bounce(named("ball"), 0.8), "the ball: bounce = 0.8"],
  ["the ramp is slippery", grip(named("ramp"), 0), "the ramp: grip off, slick as ice"],
  ["the ramp is sticky", grip(named("ramp"), 3), "the ramp: grip = 3x"],
  ["ink eater", inkEater(1), "the Sumikui, the ink eater, is loose"],
  ["summon the ink eater", inkEater(1), "the Sumikui, the ink eater, is loose"],
  ["summon the Sumikui", inkEater(1), "the Sumikui, the ink eater, is loose"],
  ["release the sumikui", inkEater(1), "the Sumikui, the ink eater, is loose"],
  ["awaken the Sumi Kui", inkEater(1), "the Sumikui, the ink eater, is loose"],
  ["an ink-eater", inkEater(1), "the Sumikui, the ink eater, is loose"],
  ["banish the ink eater", inkEater(0), "the Sumikui is sealed"],
  ["seal the sumikui", inkEater(0), "the Sumikui is sealed"],
  ["no ink eater", inkEater(0), "the Sumikui is sealed"],
  ["the ink eater is gone", inkEater(0), "the Sumikui is sealed"],
  ["stop the ink eater", inkEater(0), "the Sumikui is sealed"],
];

const NOT_RULES: readonly string[] = [
  "",
  "   ",
  "hello",
  "a mushroom",
  "bouncy mushroom",
  "rock",
  "ladder",
  "a heavy rock",
  "eat me",
  "drink me",
  "the moon",
  "moon",
  "a little girl",
  "flying girl",
  "a tiny hero",
  "fast character",
  "half moon",
  "a cow on the moon",
  "mars bar",
  "earth",
  "ice",
  "a block of ice",
  "bouncy",
  "very bouncy",
  "bouncy thing",
  "slippery soap",
  "sticky glue",
  "light feather",
  "heavy",
  "hot air balloon",
  "a fan",
  "storm",
  "wind",
  "wind chime",
  "gravity",
  "gravity boots",
  "time",
  "time bomb",
  "tea time",
  "a slow snail",
  "ground",
  "goal",
  "lava",
  "the floor is lava",
  "alice starts here",
  "finish line",
  "rabbit hole",
  "up",
  "no",
  "2",
  "gravity = (0.3, -1)",
  "reset everything",
  "ink",
  "black ink",
  "eat me",
  "a hungry cat",
  "a spinning wheel",
  "the wheel",
  "alice spins",
  "the girl spins",
];

describe("the offline rule grammar", () => {
  const compiler = createRuleCompiler();

  it.each(UNDERSTOOD)("understands %j", async (says, effect, gloss) => {
    expect(await compiler.compile(says)).toEqual({ effect, explanation: gloss });
  });

  it.each(NOT_RULES)("leaves %j to be a name or a remark", async (says) => {
    expect(await compiler.compile(says)).toBeNull();
  });

  it.each(["gravity up", "gravity points left", "wind up", "no wind"])(
    "never writes a negative zero for %j",
    async (says) => {
      const rule = await compiler.compile(says);
      const numbers = Object.values(rule?.effect ?? {});
      expect(numbers.some((value) => Object.is(value, -0))).toBe(false);
    },
  );

  it("rounds a fractional clone request to a supported count", async () => {
    expect((await compiler.compile("2.5 clones"))?.effect).toEqual({
      governs: "clones",
      value: 3,
    });
  });
});
